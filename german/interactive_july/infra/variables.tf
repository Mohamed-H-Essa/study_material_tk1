variable "region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-3" # Paris; matches the account's configured region
}

variable "suffix" {
  description = "Unique suffix for globally-unique bucket names (e.g. your AWS account id or initials)"
  type        = string
}

variable "token_secret" {
  description = "HMAC secret used to sign login tokens. Change to a random string."
  type        = string
  default     = "change-me-to-something-random"
  sensitive   = true
}

variable "pw_mohamed" {
  description = "Password for user 'mohamed'"
  type        = string
  default     = "123"
  sensitive   = true
}

variable "pw_mustafa" {
  description = "Password for user 'mustafa'"
  type        = string
  default     = "123"
  sensitive   = true
}
