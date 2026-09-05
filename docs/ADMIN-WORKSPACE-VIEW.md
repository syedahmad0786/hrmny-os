# Employee workspace view

Partners and directors can open **Account → View employee workspace** and select an active employee. The page reloads with that employee's roles, dashboard and assigned work. The amber banner identifies the employee and provides **Return to my workspace**. Ordinary staff cannot switch employees.

Preview supports Today, Sales overview and pipeline, My work, Work, Clients, Delivery and Reports. It is read-only: the server rejects all mutations and any query outside the operational allowlist. Existing feature and permission checks apply to both the employee and the real admin. Every preview request batch records the real admin and selected employee in the audit log.

Private mail and conversations, personal notifications, chat, AI history, connected accounts, credentials and administrative settings are excluded. Existing email ownership and restricted archive access remain in force. An excluded route shows a return link instead of the underlying page.

**Back** returns to the preceding in-app page. A directly opened link falls back to its section overview. **Notifications** opens your notifications. **Account → Connected tools** manages your integrations; **Preview client portal** opens the separate client preview; **Audit log** opens activity history. The account avatar opens this menu rather than signing you out.

The preview is stored only for the current browser tab and never replaces the authenticated admin's identity. Returning to your workspace or signing out clears it and reloads the page to discard cached employee data.
