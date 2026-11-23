output "app_url" {
  value = "https://${var.app_domain}"
}

output "vm_public_ip" {
  value = google_compute_address.ip.address
}

output "deploy_user" {
  value = var.deploy_user
}

output "app_path" {
  value = var.app_path
}

output "ssh" {
  value = "gcloud compute ssh ${google_compute_instance.vm.name} --zone ${var.zone} --project ${var.project_id} --tunnel-through-iap"
}
