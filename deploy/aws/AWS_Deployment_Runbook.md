# Flexee Wrapper — AWS Deployment Runbook

**For:** Akshay · **From:** Vikram · **Version 1.0 — 26 September 2026**

---

> ## ⚠️ Read this first — most of this document is superseded (9 October 2026)
>
> It describes a deployment that was never built: Docker Compose, Caddy, RDS, `/opt/flexee`. **The
> box runs the app as the systemd unit `flexee-wrapper` (`npm run start`, port 3000) behind nginx,
> from `/var/www/Flexee_Wrapper`, against a local Postgres**, and it is shared with
> `flexee-adv-backend`, `flexee-bpm`, `flexee-da-backend` and `flexee-erp-backend` — do not touch
> those. Spec 28 Addendum F deferred RDS, S3 and a separate data volume.
>
> Parts A to H below are kept only as the record of what was planned. **Spec 28 commit 13 rewrites
> this document.** Until then, the only part of it written against the box as it actually is, and
> therefore the only part safe to follow, is **Part I**.

---

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
   **Viewer**: `FZ1001_v2_CURRENT` and `Flexee_Standards`. Wait for his confirmation before Part F.

## Part F — Load the current SAD book

Run from `/opt/flexee/flexee-reader`. Vikram will give you the two folder ids (the last part of each
folder's Drive URL).

```bash
cd /opt/flexee/flexee-reader
/opt/flexee/venv/bin/python tools/flexee_intake.py --book-id sad \
  --drive-folder <FZ1001_v2_CURRENT id> \
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

---

## Part I — The book intake worker (`flexee-intake.service`)

**Written against the box as it is. Spec 28 commit 7.**

Adding a book used to run in GitHub Actions: the app dispatched
`.github/workflows/library-intake.yml` and a GitHub runner did the work. That cannot work any more
— the uploaded zip is a file under `FILES_DIR` on this box and the books are a directory under
`CONTENT_DIR`, and a runner can reach neither. A small worker on the box does it instead.

It has no queue of its own. A row in `library_uploads` with status `checking` is a check waiting to
run and one with `publishing` is a publish waiting to run, both written by the app when somebody
clicked. The worker polls those two, oldest first, runs **one at a time**, and takes a Postgres
advisory lock on the book id so that a second worker or a hand-run job cannot work on the same book
at the same time.

### Install

1. **Create the three directories**, if they are not there already, owned by the same user
   `flexee-wrapper` runs as (`systemctl show -p User flexee-wrapper` says which):
   ```bash
   sudo mkdir -p /var/lib/flexee/content /var/lib/flexee/files /var/lib/flexee/work
   sudo chown -R <that-user>:<that-group> /var/lib/flexee
   sudo chmod 750 /var/lib/flexee
   ```
2. **Add the settings** to `/var/www/Flexee_Wrapper/.env`, from `deploy/aws/.env.example`:
   `CONTENT_DIR`, `FILES_DIR`, `INTAKE_WORK_DIR`, `CONTENT_STORE=fs`, `INTAKE_MODE=worker`, and
   optionally `INTAKE_MIN_FREE_MB` (default 1024). `INTAKE_MODE=worker` is what stops the app
   dispatching a GitHub workflow it no longer needs.
3. **Check `python3` and Pillow are present**, since the intake builds figures with them:
   ```bash
   python3 -c "import PIL, sys; print(PIL.__version__, sys.version)"
   ```
   If that fails: `sudo apt-get install -y python3-pil` (do not pip-install into the system Python
   on a box four other services share).
4. **Copy the unit in and fill in its four CONFIRM lines** — `User`, `Group`, `EnvironmentFile`
   and the path to `npm` — by copying them from the unit that already works:
   ```bash
   systemctl cat flexee-wrapper              # take User, Group, EnvironmentFile, and npm's path
   sudo cp /var/www/Flexee_Wrapper/deploy/aws/flexee-intake.service /etc/systemd/system/
   sudo nano /etc/systemd/system/flexee-intake.service
   sudo systemctl daemon-reload
   ```
5. **Add the sudoers rule** so `deploy.sh` can restart it. Check how the existing one is written
   first, and match it exactly — sudoers matches the command line as typed, so a rule for
   `... restart flexee-intake.service` does **not** permit `systemctl restart flexee-intake`:
   ```bash
   sudo grep -rn flexee /etc/sudoers /etc/sudoers.d/
   ```
   Then, in a new file so nothing existing is edited (`sudo visudo -f
   /etc/sudoers.d/flexee-intake`), with `<deploy-user>` the user the GitHub runner and `deploy.sh`
   run as:
   ```
   <deploy-user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart flexee-intake
   ```
   `deploy.sh` runs `sudo systemctl restart flexee-intake`, without the `.service` suffix, to match
   how it already restarts `flexee-wrapper`. If the existing rule for `flexee-wrapper` uses a
   different path for `systemctl` (`/bin/systemctl` on some images), use that path here too.
   Check the file parses, which `visudo` does on save, and then that it works:
   ```bash
   sudo -n systemctl restart flexee-intake && echo "the rule works"
   ```
6. **Start it and watch it come up:**
   ```bash
   sudo systemctl enable --now flexee-intake
   systemctl status flexee-intake --no-pager
   journalctl -u flexee-intake -n 30 --no-pager
   ```
   The first line of the log names the store and the three directories. If it says
   `DATABASE_URL is not set`, step 2 is incomplete.
7. **Raise the nginx body limits**, per location and not globally — a book zip is up to 200 MB and
   nginx's own default is 1 MB, so without this an upload dies at 1 MB with nginx's 413 and not the
   app's message:
   ```nginx
   location /api/library/upload { client_max_body_size 256m; proxy_request_buffering off; proxy_pass http://127.0.0.1:3000; }
   location /api/files/upload   { client_max_body_size 64m;                                 proxy_pass http://127.0.0.1:3000; }
   ```
   Copy the other `proxy_set_header` lines from the existing `location /` block, then
   `sudo nginx -t && sudo systemctl reload nginx`. 256m and 64m sit above the app's own caps of
   200 MB and 50 MB deliberately, so an oversized file meets the app's sentence rather than a bare
   nginx error page.
8. **Prove it end to end** with a real book: upload one at `/library`, watch
   `journalctl -u flexee-intake -f`, and check `/admin/status` afterwards. Send Vikram the
   journal lines for the check and the publish.

### What to expect, and what to do about it

| What you see | What it means |
|---|---|
| `intake worker: check sad (<id>) -> ready` | normal; the faculty member now clicks to add it |
| `intake worker: removed the upload zip … now that sad is published` | normal; a published zip is deleted, the archive keeps the previous version |
| `intake worker: refused …: There is not enough free space …` | the free-disk floor stopped it before it filled the disk. Free space; the record says the same thing on the Library page |
| The unit in `failed` state | five restarts in five minutes, most likely the memory cap. `journalctl -u flexee-intake -n 100`, then tell Vikram the book and the last lines |
| A row stuck in `checking` with the unit stopped | nothing is polling. Start the unit; it picks the row up again |

`systemctl restart flexee-intake` is safe at any time: the worker finishes the job it is on and
then exits, which is why the unit allows ten minutes to stop. `deploy.sh` restarts it on every
deploy for that reason.

**Do not run `npm run intake:worker` by hand while the unit is running.** The advisory lock will
stop the second one touching a book the first is working on, but two pollers is not a state to
debug in.

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
