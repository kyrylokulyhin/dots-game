locals {
  labels = { app = var.name_prefix }
}

# ---------------------------------------------------------------- APIs

resource "google_project_service" "apis" {
  for_each           = toset(["compute.googleapis.com", "iam.googleapis.com", "secretmanager.googleapis.com"])
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------- identity

resource "google_service_account" "vm" {
  account_id   = "${var.name_prefix}-vm"
  display_name = "Dots game VM"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "vm_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.vm.email}"
}

# ---------------------------------------------------------------- TLS key/cert for nginx (from cloudflare.tf)

resource "google_secret_manager_secret" "origin" {
  for_each  = toset(["cert", "key"])
  secret_id = "${var.name_prefix}-origin-${each.key}"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "origin_cert" {
  secret      = google_secret_manager_secret.origin["cert"].id
  secret_data = cloudflare_origin_ca_certificate.origin.certificate
}

resource "google_secret_manager_secret_version" "origin_key" {
  secret      = google_secret_manager_secret.origin["key"].id
  secret_data = tls_private_key.origin.private_key_pem
}

resource "google_secret_manager_secret_iam_member" "vm_read" {
  for_each  = google_secret_manager_secret.origin
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm.email}"
}

# ---------------------------------------------------------------- network

resource "google_compute_address" "ip" {
  name       = "${var.name_prefix}-ip"
  region     = var.region
  depends_on = [google_project_service.apis]
}

# HTTPS only from Cloudflare's edge, so nobody can bypass it
resource "google_compute_firewall" "https_from_cloudflare" {
  name          = "${var.name_prefix}-https-cloudflare"
  network       = "default"
  direction     = "INGRESS"
  source_ranges = data.cloudflare_ip_ranges.cf.ipv4_cidrs
  target_tags   = [var.name_prefix]
  allow {
    protocol = "tcp"
    ports    = ["443"]
  }
  depends_on = [google_project_service.apis]
}

# SSH for GitHub Actions deploys (key-only) and Identity-Aware Proxy
resource "google_compute_firewall" "ssh" {
  name          = "${var.name_prefix}-ssh"
  network       = "default"
  direction     = "INGRESS"
  source_ranges = distinct(concat(var.ssh_allowed_cidrs, ["35.235.240.0/20"]))
  target_tags   = [var.name_prefix]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
  depends_on = [google_project_service.apis]
}

# ---------------------------------------------------------------- storage for the database

resource "google_compute_disk" "data" {
  name   = "${var.name_prefix}-data"
  type   = "pd-standard"
  zone   = var.zone
  size   = var.data_disk_size_gb
  labels = local.labels

  # Holds accounts and game history. Remove this only if you really want to delete it.
  lifecycle {
    prevent_destroy = true
  }
  depends_on = [google_project_service.apis]
}

resource "google_compute_resource_policy" "daily_snapshot" {
  count  = var.snapshot_retention_days > 0 ? 1 : 0
  name   = "${var.name_prefix}-daily-snapshot"
  region = var.region
  snapshot_schedule_policy {
    schedule {
      daily_schedule {
        days_in_cycle = 1
        start_time    = "04:00"
      }
    }
    retention_policy {
      max_retention_days    = var.snapshot_retention_days
      on_source_disk_delete = "KEEP_AUTO_SNAPSHOTS"
    }
    snapshot_properties {
      labels            = local.labels
      storage_locations = [var.region]
    }
  }
}

resource "google_compute_disk_resource_policy_attachment" "data_snapshots" {
  count = var.snapshot_retention_days > 0 ? 1 : 0
  name  = google_compute_resource_policy.daily_snapshot[0].name
  disk  = google_compute_disk.data.name
  zone  = var.zone
}

# ---------------------------------------------------------------- the VM

resource "google_compute_instance" "vm" {
  name                      = var.name_prefix
  machine_type              = var.machine_type
  zone                      = var.zone
  tags                      = [var.name_prefix]
  labels                    = local.labels
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 10
      type  = "pd-standard"
    }
  }

  attached_disk {
    source      = google_compute_disk.data.id
    device_name = "dots-data"
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.ip.address
    }
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot = true
  }

  metadata = {
    startup-script = templatefile("${path.module}/startup.sh.tftpl", {
      app_path          = var.app_path
      deploy_user       = var.deploy_user
      deploy_public_key = trimspace(var.deploy_public_key)
      cert_secret       = google_secret_manager_secret.origin["cert"].secret_id
      key_secret        = google_secret_manager_secret.origin["key"].secret_id
    })
  }

  depends_on = [
    google_secret_manager_secret_version.origin_cert,
    google_secret_manager_secret_version.origin_key,
    google_secret_manager_secret_iam_member.vm_read,
  ]
}
