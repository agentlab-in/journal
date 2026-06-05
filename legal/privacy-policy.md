# Privacy Policy

**Effective Date:** June 4, 2026  
**Version:** v1  
**Platform:** agentlab.in  
**Operator:** Harshit Singh Bhandari (individual, India)  
**Contact:** harshit@agentlab.in

---

## 1. Overview

agentlab.in is a free community publishing platform for AI agent infrastructure knowledge. This Privacy Policy explains what data we collect, why we collect it, how we store and protect it, and what rights you have over it.

By using agentlab.in, you agree to the practices described in this policy.

---

## 2. What We Collect and Why

### 2.1 GitHub Authentication Data

When you sign in with GitHub (our only authentication method), GitHub shares the following with us under OAuth:

| Data | Why we collect it |
|------|-------------------|
| GitHub username | Your public identity on the platform |
| Display name | Shown on your profile and posts |
| Avatar URL | Your profile picture |
| GitHub user ID | Unique identifier for your account |
| GitHub account creation date | To verify the anti-spam eligibility gate |
| Public repository count | To verify the anti-spam eligibility gate |
| Bio, followers count, public email (when set on your GitHub profile) | Inputs to our automated anti-spam soft-flag (see §2.2a) |

If you have a public email on your GitHub profile, GitHub shares it with us under OAuth. We store it in `next_auth.users.email` and use it as one of several signals in our automated anti-spam evaluation. We never send email to it; it is not used for marketing.

### 2.2 Signup Audit Data

At the moment you create an account, we record your GitHub account age and public repository count. These values are refreshed on every signin so the anti-spam gate is re-evaluated each time you log in. We do not use them for any purpose beyond the gate decision and operator-side abuse review.

### 2.2a Automated Soft-Flag at Signup

We compute and store an automated soft-flag (`signup_flags`) at signup based on whether your GitHub profile has a bio, a public email, and at least two followers. Flagged accounts get priority moderator review but are not blocked. The flag value is visible only to the operator.

### 2.3 User-Generated Content

Everything you publish or interact with on the platform is stored:

- Articles (Markdown source and sanitized HTML), titles, tags, cover images
- Edit history — the last 20 revisions of each post are retained until the post is deleted
- Aggregate view counts per post (anonymous)
- Comments (plain text, threaded)
- Likes, bookmarks, follows
- Content reports you submit
- Pinned post selections (up to 6)
- Profile bio and avatar URL (if you edit them)

Your display name and the canonical-case form of your GitHub username are stored when you first sign in and refreshed from GitHub on subsequent signins; they are not directly editable by you.

All published content is licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)**. You retain copyright. See Section 6 for details.

### 2.4 Uploaded Images

Cover images, inline post images, and user-uploaded avatars are accepted up to 2MB per file. On upload, we:

- Verify the file format by magic bytes (not by the upload header)
- Reject inputs larger than 6000×6000 pixels
- Resize to a maximum width of 1600px while preserving aspect ratio
- Re-encode to WebP at quality 85 — EXIF metadata is removed as a side effect of this re-encode
- Store the result in our object storage (Supabase, Mumbai region)

### 2.5 Cross-Reference Graph

`[[wikilink]]`-style references between posts are parsed and stored to enable bidirectional linking between articles. This is structural metadata derived from your content.

### 2.6 Session Data and OAuth Linkage

We use **server-side database sessions** (not JWTs or client-side tokens). A session cookie is set in your browser to keep you signed in. This cookie is functional and strictly necessary for the platform to work. It expires when you sign out or after a period of inactivity.

In addition, we store rows in `next_auth.sessions` (the active server-side session) and `next_auth.accounts` (your GitHub OAuth account linkage). The `next_auth.accounts` row historically retained the OAuth `access_token` and `refresh_token` returned by GitHub. We do not use these tokens after the initial signin; they are now cleared from existing rows and not persisted on new signins.

### 2.7 Rate-Limit Counters

Short-lived counters keyed by user ID (not IP) are stored in Upstash Redis for abuse prevention. TTLs range from one minute (e.g. engagement actions) to one hour (publish, edit, delete, report, image upload) depending on the action, and they are not used for analytics or profiling.

### 2.8 Server Logs

Vercel (our hosting provider) automatically captures standard server logs including IP addresses, browser user-agent strings, request paths, timestamps, and error traces. These logs are used for debugging and security monitoring. Retention is governed by Vercel's own data retention policies.

### 2.9 Pre-Launch Waitlist

Before the platform launched publicly, we collected email addresses via a waitlist (powered by Kit / ConvertKit) solely to send a launch notification. If you signed up for the waitlist:

- You received one email: the launch announcement.
- Your email address is stored in Kit / ConvertKit.
- You can request deletion at any time by emailing harshit@agentlab.in.

We do not send newsletters or marketing emails after launch unless you explicitly opt in to a future programme (none currently exists).

### 2.10 Consent Record

**Consent record.** When you sign in for the first time (and again whenever we materially update a policy), we record:

- timestamp of your agreement,
- the version of each document you agreed to (Terms, Content Policy, Privacy Policy),
- confirmation that you are 18+,
- your IP address and user-agent at submission time, for evidentiary purposes.

This record is retained for the lifetime of your account. When you delete your account (or refuse consent at signup), the consent rows are removed as part of the cascade delete on your user row — we do not keep a residual audit copy. This matches the DPDP Act 2023 §12 right-to-erasure posture; we accept the trade-off that a post-deletion legal dispute would not be backed by a stored consent receipt.

---

## 3. What We Do Not Do

- No advertising of any kind
- No third-party tracking cookies
- No cross-site behavioural profiling or fingerprinting
- No selling or renting of your data to third parties
- No AI generation or rewriting of your content
- No payments or financial data of any kind

---

## 4. Sub-Processors (Third-Party Services)

We share data with the following services to operate the platform:

| Service | Purpose | Data shared | Region |
|---------|---------|-------------|--------|
| **GitHub** | OAuth authentication + REST profile read on each signin | OAuth token, GitHub username; we receive profile fields on each signin (login, public_repos, created_at, bio, email, followers, avatar) | Global (GitHub Inc., US) |
| **Supabase** | Database and image storage | All stored data and uploaded files | Mumbai, India (ap-south-1) |
| **Vercel** | Hosting, CDN, server runtime | Server logs, request data | Control plane: US; Edge: global |
| **Upstash** | Rate limiting | User ID, short-lived counters | Singapore (ap-southeast-1) |
| **Kit (ConvertKit)** | Pre-launch waitlist email | Email addresses (waitlist only) | US |

We do not have sub-processors beyond this list. We will update this section if that changes.

---

## 5. Data Retention

| Data type | Retention |
|-----------|-----------|
| Account data (GitHub profile, signup audit, signup soft-flag) | Until you delete your account |
| Published content (posts, comments) | Until you delete it, or until an admin removes it under the Content Policy |
| Post edit history | Last 20 revisions per post, retained until the post is deleted |
| Uploaded images | Until the associated content is deleted |
| Likes, bookmarks, follows | Until you remove them or delete your account |
| Session cookies | Until sign-out or session expiry |
| OAuth account linkage (`next_auth.accounts`) | Until you delete your account (which you can do from `/settings/profile`) |
| Moderation audit log (`mod_actions`) | Retained indefinitely for legal record-keeping |
| Rate-limit counters | One minute to one hour depending on bucket (automatic TTL) |
| Server logs (Vercel) | Per Vercel's retention policy |
| Waitlist emails | Until you request deletion |

Soft-deleted content (removed by a moderator) is retained in an internal audit log for moderation record-keeping purposes.

---

## 6. Content Licensing

By publishing content on agentlab.in, you grant agentlab.in and all users of the platform a licence to use, share, and adapt your content under the terms of **Creative Commons Attribution 4.0 International (CC BY 4.0)**.

This means:
- You retain copyright in your work.
- Others may share and adapt your work, provided they credit you.
- You cannot revoke this licence for content already published and accessed by others under CC BY 4.0.

You represent that you have the right to licence any content you submit, and that it does not infringe the intellectual property rights of any third party.

---

## 7. Moderation and Admin Access

agentlab.in operates as an intermediary under **Section 79 of the Information Technology Act, 2000 (India)**. We do not pre-screen or endorse user-published content.

A single platform operator (Harshit Singh Bhandari) has administrative access. Admin actions are limited to:

- Soft-deleting posts or comments (with a recorded reason)
- Restoring previously soft-deleted posts or comments
- Banning users
- Approving or rejecting community-suggested tags
- Resolving user-submitted content reports

Each moderation entry records the action, target, free-text reason (optional, ≤1000 chars), and structured metadata about the target (e.g. post slug, comment author id, ban context). The operator has unrestricted technical access to all stored data via service-role credentials, and acts on the honour code that such access is exercised only for moderation, abuse response, or legal compliance.

---

## 8. Your Rights

You have the right to:

- **Access** — email harshit@agentlab.in; we will export your `public.users` row, post and comment list, likes/bookmarks/follows, reports you've filed, and any moderation actions taken against you (excluding internal moderator notes). Expect a plain JSON file within 15 days.
- **Correct** inaccurate profile data (bio, avatar) directly in your account settings. Your display name and GitHub username are sourced from GitHub and refreshed on each signin; to change them, update them on GitHub and sign back in.
- **Delete your account** from `/settings/profile`. When you do, we anonymise your profile (your username is replaced with `deleted-<short-id>`, and your bio, avatar, display name, and email are cleared), delete your OAuth account linkage and active sessions (forcing you to be signed out), and leave any published posts and comments attributed to the anonymised handle. You can also email harshit@agentlab.in if you prefer the operator handle this manually; allow up to 15 days for processing.
- **Object** to any processing you believe is unlawful.

To exercise any of these rights other than self-service deletion, email **harshit@agentlab.in**. We will respond within 15 days (and in any case within the windows required by Rule 3(2) of the IT Rules 2021 where applicable). Because all five legal contact addresses route to a single mailbox, non-urgent matters may take longer; legally time-bound matters take priority.

Note: Some data may be retained in the moderation audit log even after account deletion, where required for legal or abuse-prevention purposes.

---

## 9. Security

We take reasonable technical measures to protect your data, including:

- Server-side sessions (no JWTs stored client-side)
- EXIF stripping on all uploaded images
- Input sanitisation before HTML rendering
- HTTPS enforced across all pages
- Rate limiting on all write actions

No system is perfectly secure. If you discover a security issue, please disclose it responsibly to harshit@agentlab.in.

---

## 10. Children

agentlab.in is a technical publishing platform intended for adults. We do not knowingly collect data from anyone under the age of 18, in line with the Digital Personal Data Protection Act, 2023 (India), §9. If you believe a minor has created an account, please contact us and we will delete it.

---

## 11. Changes to This Policy

We may update this policy as the platform evolves. If we make material changes, we will update the Effective Date at the top and post a notice on the platform. Continued use after changes constitutes acceptance.

---

## 12. Contact

**Harshit Singh Bhandari**  
Operator, agentlab.in  
Email: harshit@agentlab.in  
Grievance contact: harshit@agentlab.in (see also: [Grievance Officer Notice](/grievance))
