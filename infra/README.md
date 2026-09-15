# Infrastructure

The Terraform files in this directory are an AWS foundation, not a complete
production deployment. They currently define:

- a VPC with public subnets and internet routing;
- an encrypted PostgreSQL RDS instance;
- security groups for RDS and the API task network;
- an ECS cluster;
- an IAM role for RDS enhanced monitoring; and
- a CloudWatch log group for the backend.

They do **not** define an ECS task definition, ECS service, load balancer,
RabbitMQ, frontend hosting, NAT gateway, private subnets, DNS, certificates, or
secret management. The root Docker Compose stack remains the supported local and
single-server deployment.

## Usage

```bash
cd infra
terraform init
terraform fmt -check
terraform validate
terraform plan
```

Supply `rds_username` and `rds_password` through a secure variable mechanism;
do not commit them to a `.tfvars` file. Review the public-subnet and
`0.0.0.0/0` API ingress before using this foundation outside a development
account.

The Terraform state backend must be configured before sharing an environment.