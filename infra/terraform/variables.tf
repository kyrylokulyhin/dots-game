variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "Region. us-central1, us-west1 and us-east1 qualify for the e2-micro free tier."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "Zone inside the region."
  type        = string
  default     = "us-central1-a"
}

variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
  default     = "dots"
}

variable "machine_type" {
  description = "VM size. e2-micro is the smallest (2 shared vCPU, 1 GB RAM) and is free-tier eligible."
  type        = string
  default     = "e2-micro"
}

variable "app_domain" {
  description = "Full hostname of the game, e.g. dots.example.com. Must be inside the Cloudflare zone."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID of the parent domain (same zone as kmhome)."
  type        = string
}

variable "manage_ssl_rule" {
  description = "Create a configuration rule forcing SSL Full (strict) for app_domain. Not needed when the zone is already on Full (strict), which kmhome's Terraform sets."
  type        = bool
  default     = false
}

variable "deploy_user" {
  description = "Linux user GitHub Actions connects as."
  type        = string
  default     = "deploy"
}

variable "deploy_public_key" {
  description = "SSH public key for the deploy user. bootstrap-gcp.sh generates the key pair in infra/keys/."
  type        = string
}

variable "app_path" {
  description = "Where releases live on the VM."
  type        = string
  default     = "/var/www/dots-game"
}

variable "ssh_allowed_cidrs" {
  description = "Who may SSH to the VM. GitHub-hosted runners have no fixed IPs, so the default is open; access is key-only."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "data_disk_size_gb" {
  description = "Persistent disk for the accounts/history database. Boot (10 GB) + data must stay within 30 GB for the free tier."
  type        = number
  default     = 10
}

variable "snapshot_retention_days" {
  description = "Daily snapshots of the data disk are kept this many days. 0 disables backups."
  type        = number
  default     = 7
}
