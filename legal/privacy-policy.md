# Privacy Policy

**Effective Date:** June 4, 2026  
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

We do **not** request or receive your email address from GitHub.

### 2.2 Signup Audit Data

At the moment you create an account, we record your GitHub account age and public repository count. This snapshot is stored permanently as proof that our automated anti-spam gate was applied at signup. It is not used for any other purpose.

### 2.3 User-Generated Content

Everything you publish or interact with on the platform is stored:

- Articles (Markdown source and sanitized HTML), titles, tags, cover images
- Comments (plain text, threaded)
- Likes, bookmarks, follows
- Content reports you submit
- Pinned post selections (up to 6)
- Profile bio and avatar URL (if you edit them)

All published content is licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)**. You retain copyright. See Section 6 for details.

### 2.4 Uploaded Images

Cover images, inline post images, and user-uploaded avatars are accepted up to 2MB per file. On upload, we:

- Convert the file to WebP format
- Strip all EXIF metadata (location, device info, etc.)
- Cap image dimensions
- Store the result in our object storage (Supabase, Mumbai region)

### 2.5 Cross-Reference Graph

`[[wikilink]]`-style references between posts are parsed and stored to enable bidirectional linking between articles. This is structural metadata derived from your content.

### 2.6 Session Data

We use **server-side database sessions** (not JWTs or client-side tokens). A session cookie is set in your browser to keep you signed in. This cookie is functional and strictly necessary for the platform to work. It expires when you sign out or after a period of inactivity.

### 2.7 Rate-Limit Counters

Short-lived counters keyed by user ID or IP address are stored in Redis (Upstash) for abuse prevention. These have a TTL of approximately one hour and are not used for analytics or profiling.

### 2.8 Server Logs

Vercel (our hosting provider) automatically captures standard server logs including IP addresses, browser user-agent strings, request paths, timestamps, and error traces. These logs are used for debugging and security monitoring. Retention is governed by Vercel's own data retention policies.

### 2.9 Aggregate Analytics

We use Vercel Analytics for aggregate, anonymous visit data. This does **not** use cookies, does not fingerprint your browser or IP address, and does not track you across other websites.

### 2.10 Pre-Launch Waitlist

Before the platform launched publicly, we collected email addresses via a waitlist (powered by Kit / ConvertKit) solely to send a launch notification. If you signed up for the waitlist:

- You received one email: the launch announcement.
- Your email address is stored in Kit / ConvertKit.
- You can request deletion at any time by emailing harshit@agentlab.in.

We do not send newsletters or marketing emails after launch unless you explicitly opt in to a future programme (none currently exists).

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
| **GitHub** | OAuth authentication | GitHub profile data | Global (GitHub Inc., US) |
| **Supabase** | Database and image storage | All stored data and uploaded files | Mumbai, India (ap-south-1) |
| **Vercel** | Hosting, CDN, server runtime | Server logs, request data | Control plane: US; Edge: global |
| **Upstash** | Rate limiting | User ID or IP, short-lived counters | TBD |
| **Kit (ConvertKit)** | Pre-launch waitlist email | Email addresses (waitlist only) | US |

We do not have sub-processors beyond this list. We will update this section if that changes.

---

## 5. Data Retention

| Data type | Retention |
|-----------|-----------|
| Account data (GitHub profile, signup audit) | Until you delete your account |
| Published content (posts, comments) | Until you delete it, or until an admin removes it under the Content Policy |
| Uploaded images | Until the associated content is deleted |
| Likes, bookmarks, follows | Until you remove them or delete your account |
| Session cookies | Until sign-out or session expiry |
| Rate-limit counters | ~1 hour (automatic TTL) |
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

agentlab.in operates as an intermediary under **Section 79 of the Information Technology Act, 2000 (India)**. We do not pre-screen or endorse user content.

A single platform operator (Harshit Singh Bhandari) has administrative access. Admin actions are limited to:

- Soft-deleting posts or comments (with a recorded reason)
- Banning users
- Approving or rejecting community-suggested tags
- Resolving user-submitted content reports

Every admin action is written to a moderation audit log. We do not access or read user content beyond what is necessary for moderation.

---

## 8. Your Rights

You have the right to:

- **Access** the data we hold about you
- **Correct** inaccurate profile data (bio, avatar) directly in your account settings
- **Delete** your account and associated content by contacting harshit@agentlab.in
- **Object** to any processing you believe is unlawful

To exercise any of these rights, email **harshit@agentlab.in**. We will respond within 15 days.

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

agentlab.in is a technical publishing platform intended for adults. We do not knowingly collect data from anyone under the age of 13. If you believe a minor has created an account, please contact us and we will delete it.

---

## 11. Changes to This Policy

We may update this policy as the platform evolves. If we make material changes, we will update the Effective Date at the top and post a notice on the platform. Continued use after changes constitutes acceptance.

---

## 12. Contact

**Harshit Singh Bhandari**  
Operator, agentlab.in  
Email: harshit@agentlab.in  
Grievance contact: harshit@agentlab.in (see also: [Grievance Officer Notice](/grievance))
