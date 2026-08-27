# @webface/google-mcp

The webfaCe Desk Google connector: Gmail, Calendar, Drive and Contacts as an
MCP server (stdio), authenticated with **the customer's own Google OAuth
client**. Google refuses shared clients for Gmail scopes, so every Desk owns
its consent; nothing is shared with webfaCeMEdia.

## Tools

| Tool | Does | Gate |
|---|---|---|
| `google_accounts` | connected accounts | — |
| `gmail_search` / `gmail_read` | search threads, read one in full | read |
| `gmail_draft` | create a draft (reply threads via `replyToMessageId`) | draft only |
| `gmail_send_draft` | send a draft | `confirm:true` |
| `gmail_label` | read/unread, archive, star | write |
| `calendar_list` / `calendar_free` | events, busy blocks | read |
| `calendar_create` / `calendar_update` | events with invitations | `confirm:true` |
| `drive_search` / `drive_read` | find and read Docs/Sheets/Slides/files | read |
| `contacts_search` | people by name/email/phone | read |

Every `account` argument accepts a full address or a unique prefix; with one
connected account it is implied. An ambiguous prefix is refused.

## Connect an account (what the Desk wizard walks the customer through)

1. Google Cloud Console → a project of your own → **APIs & Services → Library**:
   enable *Gmail API*, *Google Calendar API*, *Google Drive API*, *People API*.
2. **OAuth consent screen** → External → app name "webfaCe Desk", your email as
   support + developer contact → **Audience → Test users**: add the Google
   accounts you will connect. Leave it in Testing (publishing needs Google
   verification; a test-mode screen is fine for your own accounts).
3. **Credentials → Create credentials → OAuth client ID → Desktop app**. Download
   the JSON and save it as `~/.config/webface-desk/google/client_secret.json`.
4. `node apps/google-mcp/src/cli.js auth` — your browser opens; Google shows
   "hasn't verified this app" (expected: it is *your* app) → Advanced → continue.
   Repeat per account. Tokens: `~/.config/webface-desk/google/tokens/<address>.json`, mode 0600.

Scopes: `gmail.modify`, `calendar`, `drive.readonly`, `contacts.readonly`, `userinfo.email`.
Revoke any time at https://myaccount.google.com/permissions.

## Wire into a profile

```yaml
- insert:
    - id: mcp-google
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: google
        transport: stdio
        command: node
        args: ['<harness>/apps/google-mcp/src/index.js']
        env: { GOOGLE_MCP_HOME: ~/.config/webface-desk/google }
```

Tools appear to the model as `mcp__google__<tool>`.
