terraform {
  required_version = ">= 1.6.0"

  # State lives in GCS. infra/scripts/bootstrap-gcp.sh creates the bucket and writes backend.hcl:
  #   terraform init -backend-config=backend.hcl
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment (same as kmhome). Keep it out of tfvars and git.
}
