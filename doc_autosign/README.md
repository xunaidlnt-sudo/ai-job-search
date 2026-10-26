# Document auto-sign on approval

Replaces the daily routine of opening a document from email, pasting a scanned
signature over the placeholder, saving and mailing it on. Here the approver
clicks **Approve** (in the web page, in the email, or in whatever workflow tool
you already use) and their own scanned signature is stamped at the placeholder
configured for that approval step. The document then moves to the next
approver, collecting signatures as it goes.

- **Per-document configuration.** Each document type has its own ordered steps,
  and each step says where its signature goes, how big it is, and what caption
  (name, designation, date) goes under it.
- **User-specific signatures.** Every approver has their own signature image and
  optionally a separate set of initials. They upload a phone photo or scan of
  their signature and the paper background is removed automatically.
- **PDF and Word.** PDFs can use text placeholders, form fields, or a fixed box
  (for scanned PDFs that have no text). Word files use text placeholders.
- **Audit trail.** Every version is kept and SHA-256 hashed. Fully approved PDFs
  can get an extra "Approval record" page listing who approved and when.

## How it works

```
 submitter uploads PO.pdf (type: purchase_order)
        │  placeholders checked on upload - a wrong template is refused here, not at the last step
        ▼
 step 1 "Prepared by"  role: procurement ──email──▶ Ali clicks Approve ──▶ Ali's signature at {{SIGN_PREPARED}}   (v1)
 step 2 "Checked by"   role: finance     ──email──▶ Priya clicks Approve ─▶ Priya's signature at {{SIGN_CHECKED}}  (v2)
 step 3 "Approved by"  role: director    ──email──▶ Sara clicks Approve ──▶ Sara's signature at {{SIGN_APPROVED}}
                                                                            + her initials on every page footer    (v3)
        ▼
 approval record page appended, submitter emailed that the signed PDF is ready
```

A step can only be approved by someone allowed to (by role, a named user, or
the person the submitter picked), only when it is that step's turn, and by
default the same person cannot sign two steps of one document. Rejecting stops
the document and tells the submitter why.

## Try it

```bash
cd doc_autosign
pip install -r requirements.txt
python -m autosign init-demo          # demo signatures for every user + four example requests
python -m autosign serve              # http://127.0.0.1:5000
```

The login page lists the demo accounts. All use the password `demo`, and
clicking a row fills in the form:

| User ID | Name | Approves as |
|---|---|---|
| `john.staff` | John Mathew, Site Engineer | submits documents only |
| `ali.procurement` | Ali Hassan, Procurement Officer | procurement |
| `priya.finance` | Priya Nair, Finance Controller | finance, manager |
| `sara.director` | Sara Khan, Director of Operations (**admin**) | director, manager |
| `omar.hr` | Omar Farooq, HR Manager | hr |

`init-demo` seeds one request in each state: a PO waiting for Finance, a fully
signed payment voucher, a leave request waiting for Sara, and a rejected PO. To
run a document through from the start, log in as `john.staff`, submit one of
the files below, then approve it as each approver in turn.

Without SMTP settings the approval emails are written to the server log, links
included, so you can also try the email path by opening a logged link.

### Sample documents (`samples/`)

| File | Document type | What it shows |
|---|---|---|
| `purchase_order_PO-2291.pdf`, `purchase_order_PO-2288.pdf` | Purchase Order | text placeholders, three signatories, director's initials on every page, approval record page |
| `payment_voucher_PV-0418.pdf` | Payment Voucher | PDF form fields as signature boxes |
| `leave_request_john.docx` | Leave Request | Word file, placeholders in a table, submitter picks the line manager |
| `scanned_site_access_permit.pdf` | Scanned Form | fixed box by page and millimetres, for scans with no text layer |
| `signature_scan_example.jpg` | - | a raw "scan" to try on the My signature page; the background is removed on upload |

`python -m autosign init-demo --refresh-samples` regenerates them.

### Admin page

Users with `admin: true` in `users.yaml` get an **Admin** link. It shows every
request with counts by status (click a count to filter) and lets an admin cancel
a pending request. It also lists each user's signatures, with an upload form so
an admin can load a signature on someone's behalf, and gives a read-only view of
every document type's steps and placements. While any account still uses the
demo password, the admin page shows a warning.

## Preparing a document template

Put a placeholder token where each signature should go, in the Word or PDF
template your team already uses. For example, in the signature block:

```
{{SIGN_PREPARED}}          {{SIGN_CHECKED}}          {{SIGN_APPROVED}}
____________________       ____________________      ____________________
Prepared by                Checked by                Approved by
```

Small grey text is fine; the token is erased when the signature goes on. Then
check the template against its configuration:

```bash
python -m autosign check my_po_template.pdf -t purchase_order
```

For a scanned PDF (no text layer) use `mode: fixed` with a page and a box in
millimetres. For a fillable PDF you can use a form field name with `mode: field`.

## Configuration

Two files in `config/`. Both are commented, so the short version:

**`document_types.yaml`**: one entry per document type.

```yaml
purchase_order:
  name: Purchase Order
  distinct_approvers: true       # same person cannot sign two steps
  append_audit_page: true        # PDF: add an approval record page when done
  steps:
    - id: checked
      label: Checked by
      role: finance              # or  user: priya.finance   or  assignable: true
      signature:
        placeholder: "{{SIGN_CHECKED}}"
        width_mm: 38
        height_mm: 14
        anchor: over             # over | above | below | left | right of the placeholder
        offset_mm: [0, -2]
        caption: "{name}, {designation}\n{date}"
        date_format: "%d-%b-%Y"
```

A step can place several marks with one click by using `signatures:` (a list)
instead of `signature:`. The example config uses this to put the director's
signature on the approval line and their initials (`variant: initials`,
`occurrence: all`) on every page footer.

**`users.yaml`**: approvers, their roles, designation (used in captions) and
optionally a signature image path per variant. Users can also upload their own
from the **My signature** page. An upload overrides the configured file, and a
step asking for `initials` falls back to the full signature if the user has no
initials on file.

Create password hashes with `python -m autosign hash-password`. The hashes in
the example file are for the password `demo`, so replace them before real use.

## Using it from an existing workflow tool

If approvals already happen in SharePoint/Power Automate, an ERP, n8n, or
similar, keep that and call this service from its Approve action. Set
`AUTOSIGN_API_KEY` and send it in the `X-API-Key` header.

Stateless: send the file and get it back signed for one step.

```bash
curl -H "X-API-Key: $KEY" -F file=@PO-2291.pdf -F doc_type=purchase_order \
     -F step=checked -F user=priya.finance  http://server:5000/api/sign -o PO-2291_signed.pdf
```

Or let this service hold the document and track the steps:

```bash
# submit (assign_<step> picks the approver for assignable steps)
curl -H "X-API-Key: $KEY" -F file=@leave.docx -F doc_type=leave_request \
     -F submitter=john.staff -F assign_line_manager=priya.finance  http://server:5000/api/requests
# approve the current step; "step" guards against a retried call signing the next step
curl -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
     -d '{"user":"priya.finance","step":"line_manager"}'  http://server:5000/api/requests/<id>/approve
curl -H "X-API-Key: $KEY" http://server:5000/api/requests/<id>            # status + history
curl -H "X-API-Key: $KEY" http://server:5000/api/requests/<id>/document -o signed.docx
```

The API trusts the caller to say who approved, so the key belongs to the
workflow system only, not to individual users.

The CLI does the same one-off stamping without the server:
`python -m autosign stamp file.pdf -t purchase_order -s checked -u priya.finance`.

## Settings (environment variables)

| Variable | Purpose |
|---|---|
| `AUTOSIGN_SECRET_KEY` | Signs sessions and email links. Set it, or every restart logs everyone out and kills open links. |
| `AUTOSIGN_BASE_URL` | Public address used in email links, e.g. `https://approvals.company.local` |
| `AUTOSIGN_API_KEY` | Enables the REST API |
| `AUTOSIGN_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_FROM`, `_STARTTLS` | Real email. Without a host, emails go to the log. |
| `AUTOSIGN_LINK_HOURS` | Email link lifetime, default 72 |
| `AUTOSIGN_LINK_REQUIRES_LOGIN` | `1` = email links only work after the addressee logs in |
| `AUTOSIGN_CONFIG`, `AUTOSIGN_DATA` | Config and data folders (default `config/`, `data/`) |

For production run it behind your reverse proxy with HTTPS, e.g.
`gunicorn -w 2 "autosign.web:create_app('config', 'data')"`.

## Security notes

- The email link opens a review page. Only the button on that page (a POST)
  approves, so mail scanners that pre-open links cannot approve anything. A link
  stops working once its step is done or it expires.
- By default the link alone identifies the approver, which is what makes
  one-click approval possible. If emails may be forwarded, set
  `AUTOSIGN_LINK_REQUIRES_LOGIN=1`.
- Signature images are stored under `data/signatures/<user>/` with owner-only
  file permissions, and users can only view their own. Back up and protect the
  `data/` folder. It holds every document version and the database.

## Limits worth knowing

- A pasted signature image is what the current email process produces, and it is
  what this does. It is **not** a cryptographic (PKI/certificate) digital
  signature, and anyone with a PDF editor can still alter the file. The SHA-256
  hashes in the history let you prove whether a file is the one the system
  produced. If you need certificate-based signatures, a PKCS#12 signing step
  (e.g. with pyHanko) can be added after the last approval.
- Word: the signature is placed inline where the token was, so `anchor`,
  `offset_mm`, `field` and `fixed` modes are PDF-only. If Word has split a token
  across formatting runs, that paragraph's runs are merged and take the first
  run's formatting.
- `output_pdf: true` (Word → PDF on final approval) needs LibreOffice **with
  Writer** installed (`libreoffice-writer`). `libreoffice-core` alone cannot open
  Word files.
- One step at a time, in order. Parallel approvals (two people signing the same
  stage in any order) are not built in; model them as consecutive steps.

## Tests

```bash
python -m unittest discover -s tests -v
```

The suite covers PDF text/field/fixed placement including rotated pages, Word
tables and split tokens, the step and permission rules, the email-link flow and
the API.
