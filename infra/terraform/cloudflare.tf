# Cloudflare in front of the VM: proxied DNS record and an Origin CA certificate for nginx.

data "cloudflare_ip_ranges" "cf" {}

resource "cloudflare_dns_record" "app" {
  zone_id = var.cloudflare_zone_id
  name    = var.app_domain
  type    = "A"
  content = google_compute_address.ip.address
  proxied = true
  ttl     = 1 # automatic (required for proxied records)
  comment = "Managed by Terraform for dots-game"
}

# Origin certificate: trusted by Cloudflare only, valid 15 years
resource "tls_private_key" "origin" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_cert_request" "origin" {
  private_key_pem = tls_private_key.origin.private_key_pem
  subject {
    common_name = var.app_domain
  }
  dns_names = [var.app_domain]
}

resource "cloudflare_origin_ca_certificate" "origin" {
  csr                = tls_cert_request.origin.cert_request_pem
  hostnames          = [var.app_domain]
  request_type       = "origin-ecc"
  requested_validity = 5475
}

# Only needed if the zone isn't already on Full (strict). kmhome's Terraform sets it zone-wide.
resource "cloudflare_ruleset" "ssl_strict" {
  count       = var.manage_ssl_rule ? 1 : 0
  zone_id     = var.cloudflare_zone_id
  name        = "Configuration rules"
  description = "Managed by Terraform (dots-game)"
  kind        = "zone"
  phase       = "http_config_settings"
  rules = [{
    description = "Dots: SSL Full (strict)"
    expression  = "(http.host eq \"${var.app_domain}\")"
    action      = "set_config"
    action_parameters = {
      ssl = "strict"
    }
    enabled = true
  }]
}
