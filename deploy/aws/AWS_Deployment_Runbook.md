# Flexee Wrapper — AWS Deployment Runbook

**For:** Akshay · **From:** Vikram · **Version 1.0 — 26 September 2026**

This puts the Flexee Wrapper online at `https://learn.flexee.org` for the Spring 2027 sections of
MIS 3000 and MIS 3250. The Wrapper is one Docker image (Next.js) that needs a Postgres database and a
folder of book content. Nothing else: no email server, no queues, no other services.

Expected effort is about half a day. Expected cost is roughly $45–60 a month.

Everything you need is in `flexee-reader.zip`. The files this runbook refers to are in
`deploy/aws/`: `docker-compose.aws.yml`, `Caddyfile` and `.env.example`.

---

## What you will build

| Piece | AWS service | Size |
|---|---|---|
| Web server running the Wrapper and Caddy (HTTPS) | EC2 | `t3.medium`, Ubuntu 24.04, 30 GB gp3 |
| Database | RDS for PostgreSQL 16 | `db.t4g.micro`, 20 GB, encrypted |
| Fixed public address | Elastic IP | attached to the EC2 instance |
| Web address | DNS A record | `learn.flexee.org` → the Elastic IP |

Region: **us-east-2 (Ohio)**. Use the dedicated Flexee AWS account inside the One Smarter
organization, not One Smarter's production account.

---

## Part A — AWS resources

**A1. Security groups** (in the default VPC is fine):

- `flexee-web`: inbound TCP 80 and 443 from anywhere. No SSH rule.
- `flexee-db`: inbound TCP 5432 **only from** the `flexee-web` security group. Nothing else.

**A2. RDS for PostgreSQL 16.**

- Template: Production is not needed; choose Dev/Test, single-AZ.
- Instance: `db.t4g.micro`, 20 GB gp3 storage.
- Master username `flexee`; generate a strong password and store it in AWS Secrets Manager or your password manager.
- **Initial database name: `flexee`** (under Additional configuration — easy to miss).
- Encryption at rest: on. Automated backups: 14 days. Public access: **No**.
- Security group: `flexee-db`.
- Note the endpoint once it is available.

**A3. EC2 instance.**

- Ubuntu Server 24.04 LTS, `t3.medium`, 30 GB gp3 root volume.
- Security group: `flexee-web`.
- IAM instance profile with the managed policy `AmazonSSMManagedInstanceCore`, so you can log in
  with **Systems Manager Session Manager**. Do not open port 22.
- Allocate an **Elastic IP** and associate it with the instance.

## Part B — DNS

Create an **A record**: `learn.flexee.org` → the Elastic IP. Confirm it resolves
(`dig +short learn.flexee.org`) before Part D; Caddy needs it to issue the certificate.

## Part C — Server software

Connect with Session Manager, then:

```bash
sudo apt-get update && sudo apt-get -y upgrade
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# Python for the book intake tool
sudo apt-get install -y python3-pip python3-venv unzip
python3 -m venv /opt/flexee/venv
/opt/flexee/venv/bin/pip install google-auth requests Pillow
```

Log out and back in so the `docker` group takes effect.

## Part D — The app

```bash
sudo mkdir -p /opt/flexee && sudo chown ubuntu:ubuntu /opt/flexee
cd /opt/flexee
# copy flexee-reader.zip here (S3, or Session Manager port forwarding), then:
unzip flexee-reader.zip && cd flexee-reader/deploy/aws
cp .env.example .env
nano .env            # set SITE_DOMAIN and DATABASE_URL (RDS endpoint + password from A2)
chmod 600 .env
docker compose -f docker-compose.aws.yml build
docker compose -f docker-compose.aws.yml run --rm app npm run db:setup
docker compose -f docker-compose.aws.yml up -d
```

`db:setup` creates the tables, loads the books already in `content/`, loads their question banks,
and creates one default section per book. It is safe to re-run.

**Check:** open `https://learn.flexee.org`. The padlock should show a valid certificate. If the
certificate fails, DNS is not pointing at the server yet, or port 80 is blocked
(`docker compose -f docker-compose.aws.yml logs caddy` will say which).

## Part E — Google Drive access for the book intake

The intake reads each book directly from Google Drive with a read-only service account.

1. In Google Cloud Console, create a project `flexee-intake` and enable the **Google Drive API**.
2. Create a service account `flexee-intake`. No roles are needed. Create a **JSON key** and download it.
3. Put the key on the server, readable only by you:
   ```bash
   mkdir -p /opt/flexee/secrets && chmod 700 /opt/flexee/secrets
   # save the key as /opt/flexee/secrets/sa.json
   chmod 600 /opt/flexee/secrets/sa.json
   ```
4. **Send Vikram the service account's email address** (it looks like
   `flexee-intake@<project>.iam.gserviceaccount.com`). He shares two Drive folders with it as
   **Viewer**: `MIS3250_v2_CURRENT` and `Flexee_Standards`. Wait for his confirmation before Part F.

## Part F — Load the current SAD book

Run from `/opt/flexee/flexee-reader`. Vikram will give you the two folder ids (the last part of each
folder's Drive URL).

```bash
cd /opt/flexee/flexee-reader
/opt/flexee/venv/bin/python tools/flexee_intake.py --book-id sad \
  --drive-folder <MIS3250_v2_CURRENT id> \
  --standards-folder <Flexee_Standards id> \
  --credentials /opt/flexee/secrets/sa.json --out content
```

The tool prints a report and saves it as `content/_intake_report_sad.md`. **Send the report to
Vikram and wait for his go-ahead.** If the status is **STOPPED**, nothing was changed; do not work
around it — the report names the exact problem for the book team to fix.

When Vikram approves:

```bash
/opt/flexee/venv/bin/python tools/flexee_intake.py --book-id sad --out content --approve
cd deploy/aws
docker compose -f docker-compose.aws.yml run --rm app npm run db:sync-content
docker compose -f docker-compose.aws.yml run --rm app npm run db:sync-questions
```

The previous version of the book is archived under `content/_archive/`, never deleted.

## Part G — Monitoring

- CloudWatch alarm on the EC2 instance: **StatusCheckFailed** → email Vikram and you.
- CloudWatch agent (or a simple cron) alarm when the root disk passes **80%**.
- An external uptime check on `https://learn.flexee.org` (Route 53 health check or any uptime service).
- RDS: alarm on **FreeStorageSpace** below 3 GB.

The database backs itself up (14 days). The `content/` folder does not need backups: the intake can
rebuild it from Drive at any time.

## Part H — Updating later

**New app version:**
```bash
cd /opt/flexee/flexee-reader && # replace the code with the new package, keeping content/ and deploy/aws/.env
cd deploy/aws
docker compose -f docker-compose.aws.yml build
docker compose -f docker-compose.aws.yml run --rm app npm run db:deploy   # applies new migrations
docker compose -f docker-compose.aws.yml up -d
```

**New book version:** repeat Part F.

---

## Handover — send Vikram these when done

1. The live address and confirmation the HTTPS certificate is valid.
2. The service account email (Part E4) — needed before Part F.
3. The SAD intake report (Part F).
4. The join codes printed by `db:setup` for the default sections.
5. Where the database password and `sa.json` are stored, and who else has access.

## Not part of this deployment

- **Email** ("forgot password"): not needed for Spring; instructors reset passwords from the
  section roster. Amazon SES can be added later.
- **D2L / LTI**: dormant until Wright State registers the Wrapper; it needs the HTTPS address this
  deployment creates.
- **The MVCFN simulation** (SAD Thursdays) is a separate application and is not covered here.
- **Before real students sign in**, Vikram is confirming with Wright State whether storing student
  names and grades on this system needs university approval. Do not invite students until he says so.
