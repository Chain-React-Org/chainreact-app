# Handler Defaults Audit

**Purpose:** Every default value pinned by every workflow action handler under `lib/workflows/actions/`. Lands as PR-B in the contract refactor plan ([`take-a-look-at-shimmering-galaxy.md`](../../C:/Users/marcu/.claude/plans/take-a-look-at-shimmering-galaxy.md)).

**Status:** All rows have user decisions captured (resolved across four batches and the cross-cutting Notable findings). Audit is the input to PR-G (defaults migration). Per the plan's BLOCKING RULE, no PR (C1–C5, D, E, F) may change any handler default — defaults change in PR-G after the contract refactors land.

**How to use:** Read each row, fill in the `User decision` column with one of:
- `Keep` — current default is correct, no change needed
- `Change to <value>` — replace with the named value
- `Require` — make the field required (no default)
- `Discuss` — needs more thought before deciding

## Flags

Rows are flagged when the default has elevated user-facing risk:
- 🔔 **AUTO-EMAIL** — sending notifications/messages by default (spam risk)
- 🔓 **VISIBILITY** — sets sharing / visibility / permission scope
- ⏰ **TIMING** — sets a time/duration with no clear user intent
- 💵 **BILLING** — affects amount, currency, or anything with monetary impact

Unflagged rows are still in scope — the user reviews everything.

---

## Notable findings

### Calendar notification defaults are inconsistent
Calendar handlers currently default `sendNotifications` differently:
- `createEvent`, `updateEvent`, `addAttendees`, `removeAttendees`, and `moveEvent` default to `all`.
- `deleteEvent` and `quickAddEvent` default to `none`.

**Decision:** Require the field on every Calendar handler that touches attendee notifications — remove handler defaults entirely. `sendNotifications` becomes a required field at workflow-config time; UI surfaces `'none'` as the recommended/safest visible option. Tests must fail when `sendNotifications` is missing on attendee-notification-capable Calendar actions. Calendar notification behavior can email real attendees, so it must be explicit workflow configuration, not a hidden handler default.

### Drive/Docs sharing defaults stack into a notification risk
Drive/Docs sharing paths combine:
- `role = "reader"`
- `sendNotification = true`

This appears in `shareFile`, `uploadFile`, and `googleDocs.ts`.

**Decision:** Require only `sendNotification` / `sendNotificationEmail` on share-capable Drive/Docs actions — remove their handler defaults. Workflow config must explicitly set `true` or `false`; UI recommends `false`. Tests assert missing notification config fails validation. Keep `role` / `sharePermission` / `permission` defaulting to `'reader'` because it is the least-permissive useful access role. Keep the other public/domain defaults (`shareType='user'`, `shareWithDomain=false`, `makePublic=false`, `publicPermission='reader'`, `allowDiscovery=false`) as-is — they are already the least-permissive options.

### Shopify customer notification defaults differ by action
Shopify currently has:
- `createCustomer.send_welcome_email = false`
- `createFulfillment.notifyCustomer = true`

**Decision:** Keep `createCustomer.send_welcome_email=false` and `createFulfillment.notifyCustomer=true` — both match Shopify's own conventions and normal commerce expectations. Document them as intentional defaults. Require `updateOrderStatus.notify_customer` — remove the handler default and force the workflow author to explicitly choose `true` or `false`, because the customer-notification expectation depends on the specific status transition.

### Stripe defaults look comparatively disciplined
Stripe requires `currency` and `amount`. The only billing-relevant defaults found are:
- `checkout mode = "payment"`
- `quantity = 1`

**Decision:** Keep all. Record `mode='payment'` and `quantity=1` as intentional defaults. `quantity=1` is the normal line-item default. Checkout `mode='payment'` is acceptable only as a fallback after price-type auto-detection — detected subscription/setup modes must override it (verify the auto-detect logic actually does this). `amount` and `currency` remain required and must not be silently defaulted.

### AI handler has hardcoded model/temperature defaults
`aiAgentAction.ts` uses:
- `model = "gpt-4o-mini"`
- `temperature = 0.7`

This appears to violate the project rule: "never hardcode model strings — use `AI_MODELS`."

**Decision:** out of scope for handler-default behavior changes; create a separate cleanup ticket.

---

## High-concern defaults (flagged)

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/google-calendar/createEvent.ts:42](../../lib/workflows/actions/google-calendar/createEvent.ts#L42) | `sendNotifications` | `'all'` | 🔔 | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:43](../../lib/workflows/actions/google-calendar/updateEvent.ts#L43) | `sendNotifications` | `'all'` | 🔔 | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/addAttendees.ts:29](../../lib/workflows/actions/google-calendar/addAttendees.ts#L29) | `sendNotifications` | `'all'` | 🔔 | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/removeAttendees.ts:30](../../lib/workflows/actions/google-calendar/removeAttendees.ts#L30) | `sendNotifications` | `'all'` | 🔔 | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/moveEvent.ts:30](../../lib/workflows/actions/google-calendar/moveEvent.ts#L30) | `sendNotifications` | `'all'` | 🔔 | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/createEvent.ts:156](../../lib/workflows/actions/google-calendar/createEvent.ts#L156) | end-time fallback when `endTime` not supplied | `'10:00'` | ⏰ | Change — compute as start time + 1 hour, anchored to the actual start (not 1h-from-09:00). For invalid end time, fail validation rather than silently replacing. |
| [lib/workflows/actions/google-calendar/createEvent.ts:100](../../lib/workflows/actions/google-calendar/createEvent.ts#L100) | start-time fallback when format invalid | `'09:00'` | ⏰ | Change — return `success:false` with a clear validation/config error on invalid time format. Do not silently substitute `'09:00'`. |
| [lib/workflows/actions/google-calendar/createEvent.ts:60](../../lib/workflows/actions/google-calendar/createEvent.ts#L60) | timezone fallback when `Intl` unavailable | `'America/New_York'` | ⏰ | Change — resolve in order: workspace timezone → user timezone → UTC fallback. Remove `America/New_York` regional bias. Tests assert resolution order. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:103](../../lib/workflows/actions/google-calendar/updateEvent.ts#L103) | start-time fallback when format invalid | `'09:00'` | ⏰ | Change — return `success:false` with a clear validation/config error on invalid time format. Do not silently substitute `'09:00'`. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:146](../../lib/workflows/actions/google-calendar/updateEvent.ts#L146) | start-time fallback (existing event has none) | `'09:00'` | ⏰ | Keep with documentation — fallback applies only when reading/updating an existing provider event that genuinely lacks start-time data. Prefer workspace/user timezone context for the synthesized value. Document the fallback explicitly. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:153](../../lib/workflows/actions/google-calendar/updateEvent.ts#L153) | end-time fallback (existing event has none) | `'10:00'` | ⏰ | Change — compute as start time + 1 hour, anchored to the actual start. For invalid end time, fail validation. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:73](../../lib/workflows/actions/google-calendar/updateEvent.ts#L73) | timezone fallback when `Intl` unavailable | `'America/New_York'` | ⏰ | Change — resolve in order: workspace timezone → user timezone → UTC fallback. Remove `America/New_York` regional bias. Tests assert resolution order. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:86](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L86) | `eventTime` (start time) | `'09:00'` | ⏰ | Apply Calendar timing principle — `'09:00'` acceptable only as a visible product/config default, not hidden handler behavior. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:96](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L96) | `duration` minutes | `'60'` | ⏰ | Keep — equivalent of Calendar's "start + 1 hour" (Outlook uses duration semantic). Document as intentional. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:110](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L110) | `customEndTime` when duration='custom' | `'17:00'` | ⏰ | Change — fail validation if `duration='custom'` but no valid custom end time supplied. Do not silently use `'17:00'`. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:148](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L148) | `showAs` (busy/free) | `'busy'` | 🔓 | Keep — `'busy'` is standard meeting behavior. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:149](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L149) | `sensitivity` | `'normal'` | 🔓 | Keep — `'normal'` is standard sensitivity. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:152](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L152) | `onlineMeetingProvider` | `'teamsForBusiness'` | 🔓 | Keep — only applies when `isOnlineMeeting=true` (which itself defaults false). Teams is the modern/default Microsoft meeting platform. Document as intentional. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:190](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L190) | start-time fallback when format invalid | `'09:00'` | ⏰ | Change — return `success:false` with a clear validation/config error on invalid time format. Do not silently substitute `'09:00'`. |
| [lib/workflows/actions/google-calendar/createEvent.ts:43](../../lib/workflows/actions/google-calendar/createEvent.ts#L43) | `guestsCanInviteOthers` | `true` | 🔓 | Require — remove handler default. Field required at config; UI recommends `false`. Lets invite list expand beyond workflow author's configuration; must be explicit. |
| [lib/workflows/actions/google-calendar/createEvent.ts:44](../../lib/workflows/actions/google-calendar/createEvent.ts#L44) | `guestsCanSeeOtherGuests` | `true` | 🔓 | Require — remove handler default. Field required at config; UI recommends `false`. Exposes attendee email PII to other attendees; must be explicit. |
| [lib/workflows/actions/google-calendar/createEvent.ts:46](../../lib/workflows/actions/google-calendar/createEvent.ts#L46) | `visibility` | `'default'` | 🔓 | Keep — `'default'` inherits the calendar's own visibility (not a hardcoded public/private). |
| [lib/workflows/actions/google-calendar/createEvent.ts:47](../../lib/workflows/actions/google-calendar/createEvent.ts#L47) | `transparency` | `'opaque'` | 🔓 | Keep — `'opaque'` (busy on calendar) is standard meeting behavior. |
| [lib/workflows/actions/googleDrive/shareFile.ts:23](../../lib/workflows/actions/googleDrive/shareFile.ts#L23) | `role` | `'reader'` | 🔓 | Keep — least-permissive useful access role. |
| [lib/workflows/actions/googleDrive/shareFile.ts:24](../../lib/workflows/actions/googleDrive/shareFile.ts#L24) | `sendNotification` | `true` | 🔔 | Require — remove handler default. Field required at config; UI recommends `false`. Tests fail if missing for share-capable actions. |
| [lib/workflows/actions/googleDrive/shareFile.ts:21](../../lib/workflows/actions/googleDrive/shareFile.ts#L21) | `shareType` | `'user'` | 🔓 | Keep — `'user'` is least-permissive vs `'domain'` / `'anyone'`. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:51](../../lib/workflows/actions/googleDrive/uploadFile.ts#L51) | `sharePermission` | `'reader'` | 🔓 | Keep — least-permissive useful access role. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:449](../../lib/workflows/actions/googleDrive/uploadFile.ts#L449) | `sendNotificationEmail` literal in `permissions.create` | `true` | 🔔 | Require — remove handler default. Field required at config; UI recommends `false`. Tests fail if missing for share-capable actions. |
| [lib/workflows/actions/googleDrive/createFolder.ts:19](../../lib/workflows/actions/googleDrive/createFolder.ts#L19) | `shareWithDomain` (auto-share with whole domain) | `false` | 🔓 | Keep — defaults to no domain-wide auto-share (least permissive). |
| [lib/workflows/actions/googleDrive/createFolder.ts:61](../../lib/workflows/actions/googleDrive/createFolder.ts#L61) | hardcoded `role` when `shareWithDomain=true` | `'reader'` | 🔓 | Keep — least-permissive useful access role. |
| [lib/workflows/actions/googleDocs.ts:539](../../lib/workflows/actions/googleDocs.ts#L539) | `permission` | `'reader'` | 🔓 | Keep — least-permissive useful access role. |
| [lib/workflows/actions/googleDocs.ts:540](../../lib/workflows/actions/googleDocs.ts#L540) | `sendNotification` | `true` | 🔔 | Require — remove handler default. Field required at config; UI recommends `false`. Tests fail if missing for share-capable actions. |
| [lib/workflows/actions/googleDocs.ts:542](../../lib/workflows/actions/googleDocs.ts#L542) | `makePublic` | `false` | 🔓 | Keep — defaults to private (least permissive). |
| [lib/workflows/actions/googleDocs.ts:543](../../lib/workflows/actions/googleDocs.ts#L543) | `publicPermission` | `'reader'` | 🔓 | Keep — only applies when `makePublic=true`; least-permissive option. |
| [lib/workflows/actions/googleDocs.ts:544](../../lib/workflows/actions/googleDocs.ts#L544) | `allowDiscovery` | `false` | 🔓 | Keep — defaults to non-discoverable (least permissive). |
| [lib/workflows/actions/onedrive/sendSharingInvitation.ts:21](../../lib/workflows/actions/onedrive/sendSharingInvitation.ts#L21) | `role` | `'read'` | 🔓 | Keep — least-permissive useful access role (parallel to Drive `'reader'`). |
| [lib/workflows/actions/onedrive/createSharingLink.ts:20](../../lib/workflows/actions/onedrive/createSharingLink.ts#L20) | `linkType` | `'view'` | 🔓 | Keep — least-permissive vs `'edit'`/`'embed'`. |
| [lib/workflows/actions/onedrive/createSharingLink.ts:21](../../lib/workflows/actions/onedrive/createSharingLink.ts#L21) | `linkScope` | `'anonymous'` | 🔓 | Require — `'anonymous'` is too permissive for a hidden default. UI recommends least-permissive practical option (likely `'organization'` for internal flows). External-sharing workflows may need anonymous, so don't silently force a single value. |
| [lib/workflows/actions/teams/createGroupChat.ts:99](../../lib/workflows/actions/teams/createGroupChat.ts#L99) | `inviteExternalUsers` | `false` | 🔓 | Keep — safer default (no external invites). |
| [lib/workflows/actions/teams/createGroupChat.ts:100](../../lib/workflows/actions/teams/createGroupChat.ts#L100) | `sendInvitationEmail` | `true` | 🔔 | Require — apply Drive Decision 2 notification principle. Group chat invitation emails contact real people. UI recommends `false`; saved config must include explicit value. |
| [lib/workflows/actions/teams/addMemberToTeam.ts:89](../../lib/workflows/actions/teams/addMemberToTeam.ts#L89) | role behavior — empty roles when `role !== 'owner'` | `[]` (member) | 🔓 | Keep — defaults to non-owner / member-level (least privilege). |
| [lib/workflows/actions/slack/inviteUsersToChannel.ts:22](../../lib/workflows/actions/slack/inviteUsersToChannel.ts#L22) | `sendInviteNotification` | `true` | 🔔 | Require — apply Drive Decision 2 notification principle. UI recommends `false`; saved config must include explicit value. |
| [lib/workflows/actions/slack/createChannel.ts:29](../../lib/workflows/actions/slack/createChannel.ts#L29) | `isPrivate` | `false` | 🔓 | Require — same decision as `slack.ts:448 visibility`. Public/private channel creation is a workspace visibility decision; saved config must contain explicit value. |
| [lib/workflows/actions/slack.ts:448](../../lib/workflows/actions/slack.ts#L448) | `visibility` (channel) | `'public'` | 🔓 | Require — public/private channel creation is a workspace visibility decision. UI recommends `'private'`; saved config must contain explicit visibility. |
| [lib/workflows/actions/shopify/createCustomer.ts:39](../../lib/workflows/actions/shopify/createCustomer.ts#L39) | `send_welcome_email` | `false` | 🔔 | Keep — matches Shopify API default; welcome email is opt-in. Intentional. |
| [lib/workflows/actions/shopify/createFulfillment.ts:31](../../lib/workflows/actions/shopify/createFulfillment.ts#L31) | `notifyCustomer` (default when undefined) | `true` | 🔔 | Keep — matches Shopify convention; shipping notification is standard commerce expectation. Intentional. |
| [lib/workflows/actions/shopify/updateOrderStatus.ts:29](../../lib/workflows/actions/shopify/updateOrderStatus.ts#L29) | `notify_customer` | `false` | 🔔 | Require — remove handler default. Field required at config; workflow author must explicitly choose `true` or `false` because the notification expectation depends on the status transition. |
| [lib/workflows/actions/stripe/createCheckoutSession.ts:52](../../lib/workflows/actions/stripe/createCheckoutSession.ts#L52) | `mode` | `'payment'` | 💵 | Keep — fallback after price-type auto-detection. Detected subscription/setup modes must override. Verify auto-detect logic. |
| [lib/workflows/actions/stripe/createCheckoutSession.ts:28](../../lib/workflows/actions/stripe/createCheckoutSession.ts#L28) | line-item `quantity` | `1` | 💵 | Keep — normal line-item default. |
| [lib/workflows/actions/stripe/createPaymentLink.ts:27](../../lib/workflows/actions/stripe/createPaymentLink.ts#L27) | line-item `quantity` | `1` | 💵 | Keep — normal line-item default. |
| [lib/workflows/actions/hubspot/createLineItem.ts:22](../../lib/workflows/actions/hubspot/createLineItem.ts#L22) | `quantity` | `1` | 💵 | Keep — normal line-item default. |
| [lib/workflows/actions/microsoft-outlook/sendEmail.ts:47](../../lib/workflows/actions/microsoft-outlook/sendEmail.ts#L47) | `importance` | `'normal'` | 🔓 | Keep — standard message importance. |
| [lib/workflows/actions/monday/createBoard.ts:15](../../lib/workflows/actions/monday/createBoard.ts#L15) | `boardKind` | `'public'` | 🔓 | Require — public boards are visible to the workspace. UI recommends `'private'`; saved config must explicitly include `public`/`private`/`share`. |
| [lib/workflows/actions/monday/duplicateBoard.ts:15](../../lib/workflows/actions/monday/duplicateBoard.ts#L15) | `duplicateType` | `'duplicate_board_with_structure'` | 🔓 | Keep — operational copy mode (structure only, no items). |
| [lib/workflows/actions/teams/createTeam.ts:20](../../lib/workflows/actions/teams/createTeam.ts#L20) | `visibility` (read from input/config — no default; output uses `'private'`) | _unset_ → output `'private'` | 🔓 | Keep — output fallback to `'private'` is the safest default. Document as output-shape fallback (not destructure default). |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:151](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L151) | `isOnlineMeeting` | `false` | 🔓 | Keep — conservative; doesn't auto-add Teams meeting. |
| [lib/workflows/actions/google-calendar/listEvents.ts:32](../../lib/workflows/actions/google-calendar/listEvents.ts#L32) | `showDeleted` | `false` | 🔓 | Keep — read-only filter; default hides deleted events for cleaner reads. |
| [lib/workflows/actions/utility/googleSearch.ts:42](../../lib/workflows/actions/utility/googleSearch.ts#L42) | `safeSearch` | `'moderate'` | 🔓 | Keep — middle ground between `'off'` (no filter) and `'high'` (strict); matches Google's own default. |

## All defaults by provider

### airtable

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/airtable/getTableSchema.ts:17](../../lib/workflows/actions/airtable/getTableSchema.ts#L17) | `includeViews` | `true` |  | Keep — operational schema-read toggle. |
| [lib/workflows/actions/airtable/getBaseSchema.ts:16](../../lib/workflows/actions/airtable/getBaseSchema.ts#L16) | `includeTableViews` | `false` |  | Keep — operational schema-read toggle. |
| [lib/workflows/actions/airtable/listRecords.ts:20](../../lib/workflows/actions/airtable/listRecords.ts#L20) | `maxRecords` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/airtable/listRecords.ts:27](../../lib/workflows/actions/airtable/listRecords.ts#L27) | `sortOrder` | `'desc'` |  | Keep — read-only sort default. |
| [lib/workflows/actions/airtable/listRecords.ts:158](../../lib/workflows/actions/airtable/listRecords.ts#L158) | `effectiveMaxRecords` fallback | `100` |  | Keep — pagination cap fallback. |
| [lib/workflows/actions/airtable/findRecord.ts:18](../../lib/workflows/actions/airtable/findRecord.ts#L18) | `searchMode` | `'field_match'` |  | Keep — read-only search behavior. |
| [lib/workflows/actions/airtable/findRecord.ts:21](../../lib/workflows/actions/airtable/findRecord.ts#L21) | `matchType` | `'any'` |  | Keep — read-only search behavior. |
| [lib/workflows/actions/airtable/findRecord.ts:22](../../lib/workflows/actions/airtable/findRecord.ts#L22) | `caseSensitive` | `false` |  | Keep — read-only search behavior. |
| [lib/workflows/actions/airtable/findRecord.ts:24](../../lib/workflows/actions/airtable/findRecord.ts#L24) | `returnFirst` | `'first'` |  | Keep — read-only search behavior. |
| [lib/workflows/actions/airtable/deleteRecord.ts:17](../../lib/workflows/actions/airtable/deleteRecord.ts#L17) | `deleteMode` | `'single_record'` |  | Keep — defaults to safer single-record mode (vs bulk). |
| [lib/workflows/actions/airtable/deleteRecord.ts:75](../../lib/workflows/actions/airtable/deleteRecord.ts#L75) | `searchMode` | `'field_match'` |  | Keep — search-mode operational. |
| [lib/workflows/actions/airtable/deleteRecord.ts:78](../../lib/workflows/actions/airtable/deleteRecord.ts#L78) | `matchType` | `'any'` |  | Keep — search-mode operational. |
| [lib/workflows/actions/airtable/deleteRecord.ts:79](../../lib/workflows/actions/airtable/deleteRecord.ts#L79) | `caseSensitive` | `false` |  | Keep — search-mode operational. |
| [lib/workflows/actions/airtable/deleteRecord.ts:81](../../lib/workflows/actions/airtable/deleteRecord.ts#L81) | `maxRecords` | `10` |  | Keep — search-mode delete cap (low default for safety). |
| [lib/workflows/actions/airtable/moveRecord.ts:23](../../lib/workflows/actions/airtable/moveRecord.ts#L23) | `preserveRecordId` | `false` |  | Keep — operational. |
| [lib/workflows/actions/airtable/createMultipleRecords.ts:34](../../lib/workflows/actions/airtable/createMultipleRecords.ts#L34) | `maxRecords` cap | `10` |  | Keep — bulk-create cap. |
| [lib/workflows/actions/airtable/createMultipleRecords.ts:104](../../lib/workflows/actions/airtable/createMultipleRecords.ts#L104) | `inputMode` | `'individual'` |  | Keep — operational. |
| [lib/workflows/actions/airtable/addAttachment.ts:22](../../lib/workflows/actions/airtable/addAttachment.ts#L22) | `fileSource` | `'url'` |  | Keep — operational. |
| [lib/workflows/actions/airtable/createRecord.ts:477](../../lib/workflows/actions/airtable/createRecord.ts#L477) | `directFields` | `{}` |  | Keep — empty-object init. |
| [lib/workflows/actions/airtable/updateRecord.ts:57](../../lib/workflows/actions/airtable/updateRecord.ts#L57) | `directFields` | `{}` |  | Keep — empty-object init. |

### ai

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/aiAgentAction.ts:83](../../lib/workflows/actions/aiAgentAction.ts#L83) | `signatureType` | `'none'` |  | Keep — operational format picker. |
| [lib/workflows/actions/aiAgentAction.ts:98](../../lib/workflows/actions/aiAgentAction.ts#L98) | `signaturePrefix` lookup default | `'best'` |  | Keep — operational lookup default. |
| [lib/workflows/actions/aiAgentAction.ts:208](../../lib/workflows/actions/aiAgentAction.ts#L208) | `actionType` | `'custom'` |  | Keep — operational AI action type. |
| [lib/workflows/actions/aiAgentAction.ts:213](../../lib/workflows/actions/aiAgentAction.ts#L213) | `respondInstructions` | `'Respond helpfully to the incoming message'` |  | Require — remove hidden fallback prompt. AI behavior is too central to workflow output to silently substitute. Workflow author must supply instruction/purpose, or UI visibly creates/saves an instruction value from a selected template. No silent handler-level fallback. |
| [lib/workflows/actions/aiAgentAction.ts:236](../../lib/workflows/actions/aiAgentAction.ts#L236) | `summarizeFormat` | `'bullets'` |  | Keep — operational format picker. |
| [lib/workflows/actions/aiAgentAction.ts:288](../../lib/workflows/actions/aiAgentAction.ts#L288) | `generateType` | `'email'` |  | Keep — operational content-type picker. |
| [lib/workflows/actions/aiAgentAction.ts:787](../../lib/workflows/actions/aiAgentAction.ts#L787) | `tone` | `'professional'` |  | Keep — intentional low-risk style default. Shapes wording but no external side effects, data access, or billing/security impact. UI may surface as visible selected option. |
| [lib/workflows/actions/aiAgentAction.ts:1112](../../lib/workflows/actions/aiAgentAction.ts#L1112) | `model` | `'gpt-4o-mini'` |  | Out of scope for this audit — violates CLAUDE.md "never hardcode model strings; use `AI_MODELS`." Track in a separate cleanup ticket. |
| [lib/workflows/actions/aiAgentAction.ts:1113](../../lib/workflows/actions/aiAgentAction.ts#L1113) | `temperature` | `0.7` |  | Out of scope for this audit — bundle with `model` in the same separate cleanup ticket. |
| [lib/workflows/actions/aiAgentAction.ts:1114](../../lib/workflows/actions/aiAgentAction.ts#L1114) | `maxTokens` | `1500` |  | Out of scope — bundle with `model` + `temperature` in the same separate cleanup ticket. |
| [lib/workflows/actions/aiRouterAction.ts:70-72](../../lib/workflows/actions/aiRouterAction.ts#L70) | output-only fallbacks for `tokensUsed/cost/confidence` | `0` |  | Keep — output-only zero fallbacks; not a config default. |

### automation

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/automation/waitForEvent.ts:67](../../lib/workflows/actions/automation/waitForEvent.ts#L67) | `timeoutAction` | `'fail'` |  | Keep — conservative; workflow fails on timeout rather than silently continuing. |

### core (workflow infrastructure — included only because they pin runtime behavior)

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/core/executeIfThen.ts:24](../../lib/workflows/actions/core/executeIfThen.ts#L24) | `continueOnFalse` | `false` |  | Keep — conservative branching default. |
| [lib/workflows/actions/core/executeIfThen.ts:25](../../lib/workflows/actions/core/executeIfThen.ts#L25) | `conditionGroups` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/core/executeIfThen.ts:26](../../lib/workflows/actions/core/executeIfThen.ts#L26) | `logicOperator` | `'and'` |  | Keep — sensible branching default. |
| [lib/workflows/actions/core/executeIfThen.ts:137](../../lib/workflows/actions/core/executeIfThen.ts#L137) | `conditionType` | `'all'` |  | Keep — operational. |
| [lib/workflows/actions/core/executeIfThen.ts:174](../../lib/workflows/actions/core/executeIfThen.ts#L174) | `conditionType` (output) | `'simple'` |  | Keep — operational. |
| [lib/workflows/actions/core/executeWait.ts:104](../../lib/workflows/actions/core/executeWait.ts#L104) | `waitType` | `'duration'` |  | Keep — sensible scheduling default. |
| [lib/workflows/actions/core/executeWait.ts:109](../../lib/workflows/actions/core/executeWait.ts#L109) | `timezone` | `'UTC'` | ⏰ | Change — resolve in order: workspace timezone → user timezone → UTC fallback. UTC is technically predictable but does not match author expectations for time-based waits ("9 AM tomorrow" should mean local, not UTC). Tests assert resolution order. |
| [lib/workflows/actions/core/executeWait.ts:113](../../lib/workflows/actions/core/executeWait.ts#L113) | `unit` | `'minutes'` | ⏰ | Keep — sensible scheduling default. |
| [lib/workflows/actions/core/executeWait.ts:119](../../lib/workflows/actions/core/executeWait.ts#L119) | `time` | `'12:00'` | ⏰ | Keep — fallback used only if user supplied a date but no time. |
| [lib/workflows/actions/core/executeWait.ts:133](../../lib/workflows/actions/core/executeWait.ts#L133) | `businessStartTime` | `'09:00'` | ⏰ | Keep — standard business hours. |
| [lib/workflows/actions/core/executeWait.ts:134](../../lib/workflows/actions/core/executeWait.ts#L134) | `businessEndTime` | `'17:00'` | ⏰ | Keep — standard business hours. |

### discord

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/discord.ts:138](../../lib/workflows/actions/discord.ts#L138) | `embed` | `false` |  | Keep — message UI option. |
| [lib/workflows/actions/discord.ts:142](../../lib/workflows/actions/discord.ts#L142) | `embedFields` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/discord.ts:146](../../lib/workflows/actions/discord.ts#L146) | `embedTimestamp` | `false` |  | Keep — UI option. |
| [lib/workflows/actions/discord.ts:606](../../lib/workflows/actions/discord.ts#L606) | createChannel `type` | `0` |  | Keep — text channel (Discord's normal default). |
| [lib/workflows/actions/discord.ts:608](../../lib/workflows/actions/discord.ts#L608) | createChannel `nsfw` | `false` |  | Keep — safer default. |
| [lib/workflows/actions/discord.ts:624](../../lib/workflows/actions/discord.ts#L624) | createChannel `permissionOverwrites` | `[]` |  | Keep — empty perms. |
| [lib/workflows/actions/discord.ts:1223](../../lib/workflows/actions/discord.ts#L1223) | fetchMessages `limit` | `20` |  | Keep — pagination cap. |
| [lib/workflows/actions/discord.ts:1224](../../lib/workflows/actions/discord.ts#L1224) | fetchMessages `sortOrder` | `'newest'` |  | Keep — read-only sort. |
| [lib/workflows/actions/discord.ts:1225](../../lib/workflows/actions/discord.ts#L1225) | fetchMessages `filterType` | `'none'` |  | Keep — filter operational. |
| [lib/workflows/actions/discord.ts:1228](../../lib/workflows/actions/discord.ts#L1228) | fetchMessages `caseSensitive` | `false` |  | Keep — search operational. |
| [lib/workflows/actions/discord.ts:1642](../../lib/workflows/actions/discord.ts#L1642) | listChannels `limit` | `50` |  | Keep — pagination cap. |
| [lib/workflows/actions/discord.ts:1645](../../lib/workflows/actions/discord.ts#L1645) | listChannels `sortBy` | `'position'` |  | Keep — read-only sort. |
| [lib/workflows/actions/discord.ts:1646](../../lib/workflows/actions/discord.ts#L1646) | listChannels `includeArchived` | `false` |  | Keep — filter operational. |
| [lib/workflows/actions/discord.ts:1809](../../lib/workflows/actions/discord.ts#L1809) | guildMembers `limit` | `50` |  | Keep — pagination cap. |
| [lib/workflows/actions/discord.ts:1812](../../lib/workflows/actions/discord.ts#L1812) | guildMembers `sortBy` | `'joined'` |  | Keep — read-only sort. |
| [lib/workflows/actions/discord.ts:1813](../../lib/workflows/actions/discord.ts#L1813) | guildMembers `includeBots` | `false` |  | Keep — filter operational. |

### dropbox

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/dropbox/uploadFile.ts:171](../../lib/workflows/actions/dropbox/uploadFile.ts#L171) | `path` | `''` |  | Keep — empty path = root. |
| [lib/workflows/actions/dropbox/findFiles.ts:164](../../lib/workflows/actions/dropbox/findFiles.ts#L164) | `path` | `""` |  | Keep — empty path = root. |
| [lib/workflows/actions/dropbox/findFiles.ts:165](../../lib/workflows/actions/dropbox/findFiles.ts#L165) | `searchQuery` | `""` |  | Keep — empty search default. |
| [lib/workflows/actions/dropbox/findFiles.ts:166](../../lib/workflows/actions/dropbox/findFiles.ts#L166) | `fileType` | `"any"` |  | Keep — operational filter. |
| [lib/workflows/actions/dropbox/findFiles.ts:168](../../lib/workflows/actions/dropbox/findFiles.ts#L168) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/dropbox/findFiles.ts:169](../../lib/workflows/actions/dropbox/findFiles.ts#L169) | `sortBy` | `"modified_desc"` |  | Keep — read-only sort. |

### github

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/github.ts:22](../../lib/workflows/actions/github.ts#L22) | createIssue `labels` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/github.ts:23](../../lib/workflows/actions/github.ts#L23) | createIssue `assignees` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/github.ts:124](../../lib/workflows/actions/github.ts#L124) | createRepository `private` (renamed `isPrivate`) | `true` |  | Keep — defaults to private repo (safe choice). |
| [lib/workflows/actions/github.ts:125](../../lib/workflows/actions/github.ts#L125) | createRepository `autoInit` | `true` |  | Keep — convenience (creates initial commit/README). |
| [lib/workflows/actions/github.ts:226](../../lib/workflows/actions/github.ts#L226) | createPullRequest `base` | `"main"` |  | Auto-detect — when `base` not supplied, query the repo's `default_branch` via `repos.get` and use that. If lookup fails, return `success:false` with a clear config/provider error. Do not silently fall back to `'main'`. Do not make `base` required unless auto-detection proves unreliable. |
| [lib/workflows/actions/github.ts:227](../../lib/workflows/actions/github.ts#L227) | createPullRequest `draft` | `false` |  | Keep — opens as real PR, not draft. |

### gmail

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/gmail/applyLabels.ts:21](../../lib/workflows/actions/gmail/applyLabels.ts#L21) | `labels` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/gmail/applyLabels.ts:22](../../lib/workflows/actions/gmail/applyLabels.ts#L22) | `labelIds` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/gmail/applyLabels.ts:23](../../lib/workflows/actions/gmail/applyLabels.ts#L23) | `addLabels` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/gmail/applyLabels.ts:24](../../lib/workflows/actions/gmail/applyLabels.ts#L24) | `removeLabels` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/gmail/applyLabels.ts:25](../../lib/workflows/actions/gmail/applyLabels.ts#L25) | `createIfNotExists` | `false` |  | Keep — operational. |
| [lib/workflows/actions/gmail/applyLabels.ts:26](../../lib/workflows/actions/gmail/applyLabels.ts#L26) | `applyToThread` | `false` |  | Keep — operational. |
| [lib/workflows/actions/gmail/fetchEmailsWithRateLimiting.ts:27](../../lib/workflows/actions/gmail/fetchEmailsWithRateLimiting.ts#L27) | `batchSize` | `25` |  | Keep — pagination cap. |
| [lib/workflows/actions/gmail/fetchEmailsWithRateLimiting.ts:28](../../lib/workflows/actions/gmail/fetchEmailsWithRateLimiting.ts#L28) | `delayBetweenBatchesMs` | `500` |  | Keep — rate-limit operational. |
| [lib/workflows/actions/gmail/fetchEmailsWithRateLimiting.ts:29](../../lib/workflows/actions/gmail/fetchEmailsWithRateLimiting.ts#L29) | `format` | `'full'` |  | Keep — operational format. |
| [lib/workflows/actions/gmail/fetchMessage.ts:21](../../lib/workflows/actions/gmail/fetchMessage.ts#L21) | `maxResults` | `10` |  | Keep — pagination cap. |
| [lib/workflows/actions/gmail/fetchMessage.ts:22](../../lib/workflows/actions/gmail/fetchMessage.ts#L22) | `includeSpamTrash` | `false` |  | Keep — read filter. |
| [lib/workflows/actions/gmail/fetchMessage.ts:23](../../lib/workflows/actions/gmail/fetchMessage.ts#L23) | `labelIds` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/gmail/fetchMessage.ts:24](../../lib/workflows/actions/gmail/fetchMessage.ts#L24) | `format` | `'full'` |  | Keep — operational format. |
| [lib/workflows/actions/gmail/fetchMessage.ts:25](../../lib/workflows/actions/gmail/fetchMessage.ts#L25) | `includeAttachments` | `false` |  | Keep — read filter. |
| [lib/workflows/actions/gmail/fetchMessage.ts:26](../../lib/workflows/actions/gmail/fetchMessage.ts#L26) | `markAsRead` | `false` |  | Keep — non-mutating read default. |
| [lib/workflows/actions/gmail/fetchMessage.ts:27](../../lib/workflows/actions/gmail/fetchMessage.ts#L27) | `extractLinks` | `false` |  | Keep — operational. |
| [lib/workflows/actions/gmail/markAsRead.ts:66](../../lib/workflows/actions/gmail/markAsRead.ts#L66) | `messageSelection` | `'single'` |  | Keep — operational. |
| [lib/workflows/actions/gmail/markAsRead.ts:132](../../lib/workflows/actions/gmail/markAsRead.ts#L132) | `keywordMatchType` (subject) | `'any'` |  | Keep — operational. |
| [lib/workflows/actions/gmail/markAsRead.ts:145](../../lib/workflows/actions/gmail/markAsRead.ts#L145) | `keywordMatchType` (body) | `'any'` |  | Keep — operational. |
| [lib/workflows/actions/gmail/markAsRead.ts:170](../../lib/workflows/actions/gmail/markAsRead.ts#L170) | `isUnread` | `'unread'` |  | Keep — operational filter. |
| [lib/workflows/actions/gmail/markAsRead.ts:182](../../lib/workflows/actions/gmail/markAsRead.ts#L182) | `maxMessages` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/gmail/markAsUnread.ts:66](../../lib/workflows/actions/gmail/markAsUnread.ts#L66) | `messageSelection` | `'single'` |  | Keep — operational. |
| [lib/workflows/actions/gmail/markAsUnread.ts:132](../../lib/workflows/actions/gmail/markAsUnread.ts#L132) | `keywordMatchType` (subject) | `'any'` |  | Keep — operational. |
| [lib/workflows/actions/gmail/markAsUnread.ts:145](../../lib/workflows/actions/gmail/markAsUnread.ts#L145) | `keywordMatchType` (body) | `'any'` |  | Keep — operational. |
| [lib/workflows/actions/gmail/markAsUnread.ts:170](../../lib/workflows/actions/gmail/markAsUnread.ts#L170) | `isUnread` | `'read'` |  | Keep — operational filter. |
| [lib/workflows/actions/gmail/markAsUnread.ts:182](../../lib/workflows/actions/gmail/markAsUnread.ts#L182) | `maxMessages` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/gmail/createLabel.ts:19](../../lib/workflows/actions/gmail/createLabel.ts#L19) | `labelListVisibility` | `'labelShow'` |  | Keep — Gmail UI label visibility, not data exposure. |
| [lib/workflows/actions/gmail/createLabel.ts:20](../../lib/workflows/actions/gmail/createLabel.ts#L20) | `messageListVisibility` | `'show'` |  | Keep — Gmail UI label visibility, not data exposure. |
| [lib/workflows/actions/gmail/advancedSearch.ts:11](../../lib/workflows/actions/gmail/advancedSearch.ts#L11) | `searchMode` | `'filters'` |  | Keep — operational. |
| [lib/workflows/actions/gmail/advancedSearch.ts:263](../../lib/workflows/actions/gmail/advancedSearch.ts#L263) | `maxResults` | `10` |  | Keep — pagination cap. |
| [lib/workflows/actions/gmail/sendEmail.ts:47](../../lib/workflows/actions/gmail/sendEmail.ts#L47) | `priority` | `'normal'` |  | Keep — unmarked priority is the standard. |
| [lib/workflows/actions/gmail/sendEmail.ts:48](../../lib/workflows/actions/gmail/sendEmail.ts#L48) | `readReceipt` | `false` |  | Keep — privacy-respecting (no read receipt by default). |
| [lib/workflows/actions/gmail/sendEmail.ts:49](../../lib/workflows/actions/gmail/sendEmail.ts#L49) | `labels` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/gmail/sendEmail.ts:51](../../lib/workflows/actions/gmail/sendEmail.ts#L51) | `trackOpens` | `false` |  | Keep — privacy-respecting (no open tracking). |
| [lib/workflows/actions/gmail/sendEmail.ts:52](../../lib/workflows/actions/gmail/sendEmail.ts#L52) | `trackClicks` | `false` |  | Keep — privacy-respecting (no click tracking). |
| [lib/workflows/actions/gmail/sendEmail.ts:53](../../lib/workflows/actions/gmail/sendEmail.ts#L53) | `isHtml` | `false` |  | Keep — plain text by default. |
| [lib/workflows/actions/gmail/sendEmail.ts:94](../../lib/workflows/actions/gmail/sendEmail.ts#L94) | `From` header fallback | `'me'` |  | Keep — uses authenticated user's email. |
| [lib/workflows/actions/gmail/createDraft.ts:41](../../lib/workflows/actions/gmail/createDraft.ts#L41) | `subject` placeholder | `'(No Subject)'` |  | Keep — placeholder. |
| [lib/workflows/actions/gmail/downloadAttachment.ts:20](../../lib/workflows/actions/gmail/downloadAttachment.ts#L20) | `attachmentSelection` | `'all'` |  | Keep — operational. |
| [lib/workflows/actions/gmail/downloadAttachment.ts:26](../../lib/workflows/actions/gmail/downloadAttachment.ts#L26) | `filenameConflict` | `'rename'` |  | Keep — operational (non-destructive — renames rather than overwrites). |
| [lib/workflows/actions/gmail/downloadAttachment.ts:27](../../lib/workflows/actions/gmail/downloadAttachment.ts#L27) | `createDateFolder` | `false` |  | Keep — operational. |
| [lib/workflows/actions/gmail/fetchTriggerEmail.ts:94](../../lib/workflows/actions/gmail/fetchTriggerEmail.ts#L94) | mock-data `from` | `'customer@example.com'` |  | Keep — test fixture, not a real default. |

### google-analytics

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/google-analytics/createConversionEvent.ts:20](../../lib/workflows/actions/google-analytics/createConversionEvent.ts#L20) | `countingMethod` | `'ONCE_PER_EVENT'` |  | Keep — analytics operational. |
| [lib/workflows/actions/google-analytics/createConversionEvent.ts:21](../../lib/workflows/actions/google-analytics/createConversionEvent.ts#L21) | `customEvent` | `false` |  | Keep — operational flag. |

### google-calendar

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/google-calendar/createEvent.ts:27](../../lib/workflows/actions/google-calendar/createEvent.ts#L27) | `calendarId` | `'primary'` |  | Keep — operational; user's primary calendar. |
| [lib/workflows/actions/google-calendar/createEvent.ts:30](../../lib/workflows/actions/google-calendar/createEvent.ts#L30) | `allDay` | `false` |  | Keep — operational. |
| [lib/workflows/actions/google-calendar/createEvent.ts:35](../../lib/workflows/actions/google-calendar/createEvent.ts#L35) | `separateTimezones` | `false` |  | Keep — operational. |
| [lib/workflows/actions/google-calendar/createEvent.ts:40](../../lib/workflows/actions/google-calendar/createEvent.ts#L40) | `notifications` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/google-calendar/createEvent.ts:42](../../lib/workflows/actions/google-calendar/createEvent.ts#L42) | `sendNotifications` | `'all'` | 🔔 | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/createEvent.ts:43](../../lib/workflows/actions/google-calendar/createEvent.ts#L43) | `guestsCanInviteOthers` | `true` | 🔓 | Require — remove handler default. Field required at config; UI recommends `false`. Lets invite list expand beyond workflow author's configuration; must be explicit. |
| [lib/workflows/actions/google-calendar/createEvent.ts:44](../../lib/workflows/actions/google-calendar/createEvent.ts#L44) | `guestsCanSeeOtherGuests` | `true` | 🔓 | Require — remove handler default. Field required at config; UI recommends `false`. Exposes attendee email PII to other attendees; must be explicit. |
| [lib/workflows/actions/google-calendar/createEvent.ts:45](../../lib/workflows/actions/google-calendar/createEvent.ts#L45) | `guestsCanModify` | `false` |  | Keep — guests cannot modify (safe default). |
| [lib/workflows/actions/google-calendar/createEvent.ts:46](../../lib/workflows/actions/google-calendar/createEvent.ts#L46) | `visibility` | `'default'` | 🔓 | Keep — `'default'` inherits the calendar's own visibility (not a hardcoded public/private). |
| [lib/workflows/actions/google-calendar/createEvent.ts:47](../../lib/workflows/actions/google-calendar/createEvent.ts#L47) | `transparency` | `'opaque'` | 🔓 | Keep — `'opaque'` (busy on calendar) is standard meeting behavior. |
| [lib/workflows/actions/google-calendar/createEvent.ts:60](../../lib/workflows/actions/google-calendar/createEvent.ts#L60) | timezone fallback when `Intl` unavailable | `'America/New_York'` | ⏰ | Change — resolve in order: workspace timezone → user timezone → UTC fallback. Remove `America/New_York` regional bias. Tests assert resolution order. |
| [lib/workflows/actions/google-calendar/createEvent.ts:100](../../lib/workflows/actions/google-calendar/createEvent.ts#L100) | start-time fallback when format invalid | `'09:00'` | ⏰ | Change — return `success:false` with a clear validation/config error on invalid time format. Do not silently substitute `'09:00'`. |
| [lib/workflows/actions/google-calendar/createEvent.ts:135](../../lib/workflows/actions/google-calendar/createEvent.ts#L135) | event `summary` placeholder | `'Untitled Event'` |  | Keep — placeholder. |
| [lib/workflows/actions/google-calendar/createEvent.ts:156](../../lib/workflows/actions/google-calendar/createEvent.ts#L156) | end-time when not supplied | `'10:00'` | ⏰ | Change — compute as start time + 1 hour, anchored to the actual start (not 1h-from-09:00). For invalid end time, fail validation rather than silently replacing. |
| [lib/workflows/actions/google-calendar/createEvent.ts:266](../../lib/workflows/actions/google-calendar/createEvent.ts#L266) | derived `sendUpdates` baseline | `'none'` |  | Keep — internal state, not user-facing. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:27](../../lib/workflows/actions/google-calendar/updateEvent.ts#L27) | `calendarId` | `'primary'` |  | Keep — operational. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:36](../../lib/workflows/actions/google-calendar/updateEvent.ts#L36) | `separateTimezones` | `false` |  | Keep — operational. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:41](../../lib/workflows/actions/google-calendar/updateEvent.ts#L41) | `notifications` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:43](../../lib/workflows/actions/google-calendar/updateEvent.ts#L43) | `sendNotifications` | `'all'` | 🔔 | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:73](../../lib/workflows/actions/google-calendar/updateEvent.ts#L73) | timezone fallback when `Intl` unavailable | `'America/New_York'` | ⏰ | Change — resolve in order: workspace timezone → user timezone → UTC fallback. Remove `America/New_York` regional bias. Tests assert resolution order. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:103](../../lib/workflows/actions/google-calendar/updateEvent.ts#L103) | start-time fallback when format invalid | `'09:00'` | ⏰ | Change — return `success:false` with a clear validation/config error on invalid time format. Do not silently substitute `'09:00'`. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:146](../../lib/workflows/actions/google-calendar/updateEvent.ts#L146) | start-time fallback (existing event has none) | `'09:00'` | ⏰ | Keep with documentation — fallback applies only when reading/updating an existing provider event that genuinely lacks start-time data. Prefer workspace/user timezone context for the synthesized value. Document the fallback explicitly. |
| [lib/workflows/actions/google-calendar/updateEvent.ts:153](../../lib/workflows/actions/google-calendar/updateEvent.ts#L153) | end-time fallback (existing event has none) | `'10:00'` | ⏰ | Change — compute as start time + 1 hour, anchored to the actual start. For invalid end time, fail validation. |
| [lib/workflows/actions/google-calendar/addAttendees.ts:26](../../lib/workflows/actions/google-calendar/addAttendees.ts#L26) | `calendarId` | `'primary'` |  | Keep — operational. |
| [lib/workflows/actions/google-calendar/addAttendees.ts:29](../../lib/workflows/actions/google-calendar/addAttendees.ts#L29) | `sendNotifications` | `'all'` | 🔔 | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/removeAttendees.ts:26](../../lib/workflows/actions/google-calendar/removeAttendees.ts#L26) | `calendarId` | `'primary'` |  | Keep — operational. |
| [lib/workflows/actions/google-calendar/removeAttendees.ts:29](../../lib/workflows/actions/google-calendar/removeAttendees.ts#L29) | `removeAllAttendees` | `false` |  | Keep — defaults to non-bulk removal (safer). |
| [lib/workflows/actions/google-calendar/removeAttendees.ts:30](../../lib/workflows/actions/google-calendar/removeAttendees.ts#L30) | `sendNotifications` | `'all'` | 🔔 | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/moveEvent.ts:27](../../lib/workflows/actions/google-calendar/moveEvent.ts#L27) | `sourceCalendarId` | `'primary'` |  | Keep — operational. |
| [lib/workflows/actions/google-calendar/moveEvent.ts:30](../../lib/workflows/actions/google-calendar/moveEvent.ts#L30) | `sendNotifications` | `'all'` | 🔔 | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/deleteEvent.ts:27](../../lib/workflows/actions/google-calendar/deleteEvent.ts#L27) | `calendarId` | `'primary'` |  | Keep — operational. |
| [lib/workflows/actions/google-calendar/deleteEvent.ts:29](../../lib/workflows/actions/google-calendar/deleteEvent.ts#L29) | `sendNotifications` | `'none'` |  | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/quickAddEvent.ts:27](../../lib/workflows/actions/google-calendar/quickAddEvent.ts#L27) | `calendarId` | `'primary'` |  | Keep — operational. |
| [lib/workflows/actions/google-calendar/quickAddEvent.ts:29](../../lib/workflows/actions/google-calendar/quickAddEvent.ts#L29) | `sendNotifications` | `'none'` |  | Require — remove handler default. Field required at config; UI shows `'none'` as recommended. Tests fail if missing. |
| [lib/workflows/actions/google-calendar/getEvent.ts:26](../../lib/workflows/actions/google-calendar/getEvent.ts#L26) | `calendarId` | `'primary'` |  | Keep — operational. |
| [lib/workflows/actions/google-calendar/listEvents.ts:26](../../lib/workflows/actions/google-calendar/listEvents.ts#L26) | `calendarId` | `'primary'` |  | Keep — operational. |
| [lib/workflows/actions/google-calendar/listEvents.ts:29](../../lib/workflows/actions/google-calendar/listEvents.ts#L29) | `maxResults` | `250` |  | Keep — pagination cap. |
| [lib/workflows/actions/google-calendar/listEvents.ts:30](../../lib/workflows/actions/google-calendar/listEvents.ts#L30) | `orderBy` | `'startTime'` |  | Keep — read-only sort. |
| [lib/workflows/actions/google-calendar/listEvents.ts:31](../../lib/workflows/actions/google-calendar/listEvents.ts#L31) | `singleEvents` | `true` |  | Keep — operational (expands recurring events). |
| [lib/workflows/actions/google-calendar/listEvents.ts:32](../../lib/workflows/actions/google-calendar/listEvents.ts#L32) | `showDeleted` | `false` | 🔓 | Keep — read-only filter; default hides deleted events for cleaner reads. |
| [lib/workflows/actions/google-calendar/getFreeBusy.ts:29](../../lib/workflows/actions/google-calendar/getFreeBusy.ts#L29) | `timeZone` | `'UTC'` |  | Keep — sensible for technical free/busy computation. |

### google-sheets

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/google-sheets/clearRange.ts:19](../../lib/workflows/actions/google-sheets/clearRange.ts#L19) | `clearType` | `'range'` |  | Keep — operational. |
| [lib/workflows/actions/google-sheets/clearRange.ts:20](../../lib/workflows/actions/google-sheets/clearRange.ts#L20) | `whatToClear` | `'content'` |  | Keep — `'content'` is the safest clear mode (clears values only; leaves formulas/formatting intact). |
| [lib/workflows/actions/google-sheets/batchUpdate.ts:18](../../lib/workflows/actions/google-sheets/batchUpdate.ts#L18) | `inputMode` | `'simple'` |  | Keep — operational. |
| [lib/workflows/actions/google-sheets/updateRow.ts:24](../../lib/workflows/actions/google-sheets/updateRow.ts#L24) | `conditions` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/google-sheets/updateRow.ts:25](../../lib/workflows/actions/google-sheets/updateRow.ts#L25) | `updateMapping` | `{}` |  | Keep — empty default. |
| [lib/workflows/actions/google-sheets/updateRow.ts:26](../../lib/workflows/actions/google-sheets/updateRow.ts#L26) | `updateMultiple` | `false` |  | Keep — defaults to single-row update (safer). |
| [lib/workflows/actions/google-sheets/deleteRow.ts:26](../../lib/workflows/actions/google-sheets/deleteRow.ts#L26) | `deleteAll` | `false` |  | Keep — defaults to non-bulk delete (safer). |
| [lib/workflows/actions/google-sheets/formatRange.ts:19](../../lib/workflows/actions/google-sheets/formatRange.ts#L19) | `rangeSelection` | `'custom'` |  | Keep — operational. |
| [lib/workflows/actions/google-sheets/findRow.ts:21](../../lib/workflows/actions/google-sheets/findRow.ts#L21) | `matchType` | `'exact'` |  | Keep — read-only search default. |
| [lib/workflows/actions/google-sheets/createRow.ts:19](../../lib/workflows/actions/google-sheets/createRow.ts#L19) | `insertPosition` | `'append'` |  | Keep — operational. |
| [lib/workflows/actions/google-sheets/createRow.ts:24](../../lib/workflows/actions/google-sheets/createRow.ts#L24) | `fieldMapping` | `{}` |  | Keep — empty default. |
| [lib/workflows/actions/google-sheets/listRows.ts:21](../../lib/workflows/actions/google-sheets/listRows.ts#L21) | `filterOperator` | `'equals'` |  | Keep — read-only filter default. |
| [lib/workflows/actions/google-sheets/listRows.ts:23](../../lib/workflows/actions/google-sheets/listRows.ts#L23) | `additionalFilters` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/google-sheets/listRows.ts:25](../../lib/workflows/actions/google-sheets/listRows.ts#L25) | `sortOrder` | `'asc'` |  | Keep — read-only sort. |
| [lib/workflows/actions/google-sheets/listRows.ts:30](../../lib/workflows/actions/google-sheets/listRows.ts#L30) | `maxRows` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/google-sheets/listRows.ts:32](../../lib/workflows/actions/google-sheets/listRows.ts#L32) | `outputFormat` | `'objects'` |  | Keep — operational format. |
| [lib/workflows/actions/googleSheets/createSpreadsheet.ts:90](../../lib/workflows/actions/googleSheets/createSpreadsheet.ts#L90) | `title` | `'New Spreadsheet'` |  | Keep — placeholder. |
| [lib/workflows/actions/googleSheets/createSpreadsheet.ts:93](../../lib/workflows/actions/googleSheets/createSpreadsheet.ts#L93) | `sheetNames` | `['Sheet1']` |  | Keep — initial sheet name. |
| [lib/workflows/actions/googleSheets/createSpreadsheet.ts:94](../../lib/workflows/actions/googleSheets/createSpreadsheet.ts#L94) | `template` | `'blank'` |  | Keep — operational. |
| [lib/workflows/actions/googleSheets/createSpreadsheet.ts:97](../../lib/workflows/actions/googleSheets/createSpreadsheet.ts#L97) | `locale` | `'en_US'` |  | Change — resolve in order: workspace locale → user locale → `'en_US'` final fallback. Tests assert resolution order. |
| [lib/workflows/actions/googleSheets/createSpreadsheet.ts:98](../../lib/workflows/actions/googleSheets/createSpreadsheet.ts#L98) | `timeZone` | `'America/New_York'` | ⏰ | Change — apply Batch 1 Decision 3 resolution: workspace timezone → user timezone → UTC fallback. Remove `America/New_York` regional bias. Tests assert resolution order. |
| [lib/workflows/actions/googleSheets/readData.ts:23](../../lib/workflows/actions/googleSheets/readData.ts#L23) | `outputFormat` | `"objects"` |  | Keep — operational format. |

### googleDocs

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/googleDocs.ts:539](../../lib/workflows/actions/googleDocs.ts#L539) | shareDocument `permission` | `'reader'` | 🔓 | Keep — least-permissive useful access role. |
| [lib/workflows/actions/googleDocs.ts:540](../../lib/workflows/actions/googleDocs.ts#L540) | shareDocument `sendNotification` | `true` | 🔔 | Require — remove handler default. Field required at config; UI recommends `false`. Tests fail if missing for share-capable actions. |
| [lib/workflows/actions/googleDocs.ts:542](../../lib/workflows/actions/googleDocs.ts#L542) | shareDocument `makePublic` | `false` | 🔓 | Keep — defaults to private (least permissive). |
| [lib/workflows/actions/googleDocs.ts:543](../../lib/workflows/actions/googleDocs.ts#L543) | shareDocument `publicPermission` | `'reader'` | 🔓 | Keep — only applies when `makePublic=true`; least-permissive option. |
| [lib/workflows/actions/googleDocs.ts:544](../../lib/workflows/actions/googleDocs.ts#L544) | shareDocument `allowDiscovery` | `false` | 🔓 | Keep — defaults to non-discoverable (least permissive). |
| [lib/workflows/actions/googleDocs.ts:545](../../lib/workflows/actions/googleDocs.ts#L545) | shareDocument `transferOwnership` | `false` | 🔓 | Keep — defaults to no ownership transfer (least permissive). |
| [lib/workflows/actions/googleDocs.ts:751](../../lib/workflows/actions/googleDocs.ts#L751) | exportDocument `exportFormat` | `'pdf'` |  | Keep — sensible export default. |
| [lib/workflows/actions/googleDocs.ts:753](../../lib/workflows/actions/googleDocs.ts#L753) | exportDocument `destination` | `'drive'` |  | Keep — sensible export destination. |
| [lib/workflows/actions/googleDocs.ts:756](../../lib/workflows/actions/googleDocs.ts#L756) | exportDocument `emailSubject` | `'Exported Document'` |  | Keep — fallback only when `destination='email'`. |
| [lib/workflows/actions/googleDocs.ts:757](../../lib/workflows/actions/googleDocs.ts#L757) | exportDocument `emailBody` | `'Please find your exported document attached to this email.'` |  | Keep — fallback body only when `destination='email'`. Send-or-not is controlled by `destination`. |

### googleDrive

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/googleDrive/uploadFile.ts:40](../../lib/workflows/actions/googleDrive/uploadFile.ts#L40) | `sourceType` | `'file'` |  | Keep — operational. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:47](../../lib/workflows/actions/googleDrive/uploadFile.ts#L47) | `convertToGoogleDocs` | `false` |  | Keep — operational. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:48](../../lib/workflows/actions/googleDrive/uploadFile.ts#L48) | `ocr` | `false` |  | Keep — operational. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:49](../../lib/workflows/actions/googleDrive/uploadFile.ts#L49) | `ocrLanguage` | `'en'` |  | Keep — only used when `ocr=true` (which itself defaults to false), so the locale bias is dormant. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:50](../../lib/workflows/actions/googleDrive/uploadFile.ts#L50) | `shareWith` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:51](../../lib/workflows/actions/googleDrive/uploadFile.ts#L51) | `sharePermission` | `'reader'` | 🔓 | Keep — least-permissive useful access role. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:52](../../lib/workflows/actions/googleDrive/uploadFile.ts#L52) | `starred` | `false` |  | Keep — operational. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:53](../../lib/workflows/actions/googleDrive/uploadFile.ts#L53) | `keepRevisionForever` | `false` |  | Keep — operational. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:54](../../lib/workflows/actions/googleDrive/uploadFile.ts#L54) | `properties` | `{}` |  | Keep — empty default. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:55](../../lib/workflows/actions/googleDrive/uploadFile.ts#L55) | `appProperties` | `{}` |  | Keep — empty default. |
| [lib/workflows/actions/googleDrive/uploadFile.ts:449](../../lib/workflows/actions/googleDrive/uploadFile.ts#L449) | inline `sendNotificationEmail` to `permissions.create` | `true` | 🔔 | Require — remove handler default. Field required at config; UI recommends `false`. Tests fail if missing for share-capable actions. |
| [lib/workflows/actions/googleDrive/shareFile.ts:21](../../lib/workflows/actions/googleDrive/shareFile.ts#L21) | `shareType` | `'user'` | 🔓 | Keep — `'user'` is least-permissive vs `'domain'` / `'anyone'`. |
| [lib/workflows/actions/googleDrive/shareFile.ts:23](../../lib/workflows/actions/googleDrive/shareFile.ts#L23) | `role` | `'reader'` | 🔓 | Keep — least-permissive useful access role. |
| [lib/workflows/actions/googleDrive/shareFile.ts:24](../../lib/workflows/actions/googleDrive/shareFile.ts#L24) | `sendNotification` | `true` | 🔔 | Require — remove handler default. Field required at config; UI recommends `false`. Tests fail if missing for share-capable actions. |
| [lib/workflows/actions/googleDrive/createFolder.ts:19](../../lib/workflows/actions/googleDrive/createFolder.ts#L19) | `shareWithDomain` | `false` | 🔓 | Keep — defaults to no domain-wide auto-share (least permissive). |
| [lib/workflows/actions/googleDrive/createFolder.ts:61](../../lib/workflows/actions/googleDrive/createFolder.ts#L61) | hardcoded `role` when `shareWithDomain=true` | `'reader'` | 🔓 | Keep — least-permissive useful access role. |
| [lib/workflows/actions/googleDrive/listFiles.ts:24](../../lib/workflows/actions/googleDrive/listFiles.ts#L24) | `includeSubfolders` | `false` |  | Keep — operational. |
| [lib/workflows/actions/googleDrive/listFiles.ts:26](../../lib/workflows/actions/googleDrive/listFiles.ts#L26) | `orderBy` | `'name'` |  | Keep — read-only sort. |
| [lib/workflows/actions/googleDrive/listFiles.ts:27](../../lib/workflows/actions/googleDrive/listFiles.ts#L27) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/googleDrive/searchFiles.ts:20](../../lib/workflows/actions/googleDrive/searchFiles.ts#L20) | `searchMode` | `'simple'` |  | Keep — operational. |
| [lib/workflows/actions/googleDrive/searchFiles.ts:23](../../lib/workflows/actions/googleDrive/searchFiles.ts#L23) | `exactMatch` | `false` |  | Keep — operational. |
| [lib/workflows/actions/googleDrive/searchFiles.ts:28](../../lib/workflows/actions/googleDrive/searchFiles.ts#L28) | `maxResults` | `50` |  | Keep — pagination cap. |
| [lib/workflows/actions/googleDrive/getFileMetadata.ts:21](../../lib/workflows/actions/googleDrive/getFileMetadata.ts#L21) | `includePermissions` | `true` |  | Keep — useful default for downstream nodes. |
| [lib/workflows/actions/googleDrive/getFileMetadata.ts:22](../../lib/workflows/actions/googleDrive/getFileMetadata.ts#L22) | `includeOwner` | `true` |  | Keep — useful default for downstream nodes. |

### gumroad

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/gumroad/verifyLicense.ts:16](../../lib/workflows/actions/gumroad/verifyLicense.ts#L16) | `incrementUsesCount` | `false` |  | Keep — non-mutating verify default. |
| [lib/workflows/actions/gumroad/getSalesAnalytics.ts:19](../../lib/workflows/actions/gumroad/getSalesAnalytics.ts#L19) | `pageSize` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/gumroad/listSales.ts:21](../../lib/workflows/actions/gumroad/listSales.ts#L21) | `pageSize` | `10` |  | Keep — pagination cap. |

### hitl (human-in-the-loop)

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/hitl/index.ts:676](../../lib/workflows/actions/hitl/index.ts#L676) | `timeoutMinutes` | `60` |  | Keep — reasonable HITL wait. |
| [lib/workflows/actions/hitl/index.ts:747](../../lib/workflows/actions/hitl/index.ts#L747) | `timeout_action` | `'cancel'` |  | Keep — conservative default. |

### hubspot

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/hubspot.ts:19](../../lib/workflows/actions/hubspot.ts#L19) | `fieldMode` | `'basic'` |  | Keep — operational. |
| [lib/workflows/actions/hubspot.ts:60-66](../../lib/workflows/actions/hubspot.ts#L60) | `additional_properties / additional_values / all_available_fields / all_field_values / company_fields / company_field_values` | `[]` / `{}` |  | Keep — empty defaults. |
| [lib/workflows/actions/hubspot.ts:153](../../lib/workflows/actions/hubspot.ts#L153) | `duplicateHandling` | `'fail'` |  | Keep — conservative; errors on duplicate vs silent overwrite. |
| [lib/workflows/actions/hubspot/getCompanies.ts:18](../../lib/workflows/actions/hubspot/getCompanies.ts#L18) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/hubspot/getForms.ts:19](../../lib/workflows/actions/hubspot/getForms.ts#L19) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/hubspot/getDeals.ts:18](../../lib/workflows/actions/hubspot/getDeals.ts#L18) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/hubspot/getDeals.ts:24](../../lib/workflows/actions/hubspot/getDeals.ts#L24) | `sortDirection` | `'ASCENDING'` |  | Keep — read-only sort. |
| [lib/workflows/actions/hubspot/getDeals.ts:78](../../lib/workflows/actions/hubspot/getDeals.ts#L78) | filter `operator` | `'EQ'` |  | Keep — operational. |
| [lib/workflows/actions/hubspot/getOwners.ts:19](../../lib/workflows/actions/hubspot/getOwners.ts#L19) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/hubspot/getProducts.ts:19](../../lib/workflows/actions/hubspot/getProducts.ts#L19) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/hubspot/getContacts.ts:18](../../lib/workflows/actions/hubspot/getContacts.ts#L18) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/hubspot/getTickets.ts:23](../../lib/workflows/actions/hubspot/getTickets.ts#L23) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/hubspot/createTask.ts:38](../../lib/workflows/actions/hubspot/createTask.ts#L38) | `hs_task_status` | `'NOT_STARTED'` |  | Keep — sensible new-task default. |
| [lib/workflows/actions/hubspot/createTask.ts:41](../../lib/workflows/actions/hubspot/createTask.ts#L41) | `hs_task_priority` | `'MEDIUM'` |  | Keep — sensible default. |
| [lib/workflows/actions/hubspot/createTask.ts:44](../../lib/workflows/actions/hubspot/createTask.ts#L44) | `hs_task_type` | `'TODO'` |  | Keep — operational. |
| [lib/workflows/actions/hubspot/createCall.ts:51](../../lib/workflows/actions/hubspot/createCall.ts#L51) | `hs_call_status` | `'COMPLETED'` |  | Keep — operational; assumes the call already happened. |
| [lib/workflows/actions/hubspot/createMeeting.ts:55](../../lib/workflows/actions/hubspot/createMeeting.ts#L55) | `hs_meeting_outcome` | `'SCHEDULED'` |  | Keep — operational. |
| [lib/workflows/actions/hubspot/createLineItem.ts:22](../../lib/workflows/actions/hubspot/createLineItem.ts#L22) | `quantity` | `1` | 💵 | Keep — normal line-item default. |
| [lib/workflows/actions/hubspot/updateContact.ts:22](../../lib/workflows/actions/hubspot/updateContact.ts#L22) | `contactSelectionMode` | `'picker'` |  | Keep — operational. |

### logic

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/logic/executeHttpRequest.ts:33](../../lib/workflows/actions/logic/executeHttpRequest.ts#L33) | `headers` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/logic/executeHttpRequest.ts:34](../../lib/workflows/actions/logic/executeHttpRequest.ts#L34) | `queryParams` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/logic/executeHttpRequest.ts:36](../../lib/workflows/actions/logic/executeHttpRequest.ts#L36) | `authType` | `'none'` |  | Keep — only sensible default; user opts in to auth at config time. |
| [lib/workflows/actions/logic/executeHttpRequest.ts:42](../../lib/workflows/actions/logic/executeHttpRequest.ts#L42) | `timeoutSeconds` | `30` |  | Keep — reasonable timeout. |
| [lib/workflows/actions/logic/loop.ts:20](../../lib/workflows/actions/logic/loop.ts#L20) | `loopMode` | `'items'` |  | Keep — operational. |

### mailchimp

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/mailchimp/addSubscriber.ts:22](../../lib/workflows/actions/mailchimp/addSubscriber.ts#L22) | `status` | `'subscribed'` |  | Require — has CAN-SPAM/GDPR compliance implications. UI recommends `'pending'` unless explicit consent already captured. Workflow author chooses based on opt-in process. |
| [lib/workflows/actions/mailchimp/createEvent.ts:24](../../lib/workflows/actions/mailchimp/createEvent.ts#L24) | `is_syncing` | `false` |  | Keep — operational. |
| [lib/workflows/actions/mailchimp/createSegment.ts:21](../../lib/workflows/actions/mailchimp/createSegment.ts#L21) | `segmentType` | `'static'` |  | Keep — operational. |
| [lib/workflows/actions/mailchimp/createAudience.ts:20](../../lib/workflows/actions/mailchimp/createAudience.ts#L20) | `email_type_option` | `false` |  | Keep — operational. |
| [lib/workflows/actions/mailchimp/createAudience.ts:31](../../lib/workflows/actions/mailchimp/createAudience.ts#L31) | `language` | `'en'` |  | Keep — low-stakes templated content fallback. |
| [lib/workflows/actions/mailchimp/createCampaign.ts:19](../../lib/workflows/actions/mailchimp/createCampaign.ts#L19) | `type` | `'regular'` |  | Keep — operational. |
| [lib/workflows/actions/mailchimp/getSubscribers.ts:20](../../lib/workflows/actions/mailchimp/getSubscribers.ts#L20) | `status` | `'subscribed'` |  | Keep — read filter; defaults to listing subscribed users. |
| [lib/workflows/actions/mailchimp/getSubscribers.ts:21](../../lib/workflows/actions/mailchimp/getSubscribers.ts#L21) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/mailchimp/getSubscribers.ts:22](../../lib/workflows/actions/mailchimp/getSubscribers.ts#L22) | `offset` | `0` |  | Keep — pagination start. |
| [lib/workflows/actions/mailchimp/removeSubscriber.ts:21](../../lib/workflows/actions/mailchimp/removeSubscriber.ts#L21) | `delete_permanently` | `false` |  | Keep — defaults to archive vs hard delete (safer). |
| [lib/workflows/actions/mailchimp/scheduleCampaign.ts:20](../../lib/workflows/actions/mailchimp/scheduleCampaign.ts#L20) | `scheduleType` | `'absolute'` |  | Keep — operational. |
| [lib/workflows/actions/mailchimp/scheduleCampaign.ts:22](../../lib/workflows/actions/mailchimp/scheduleCampaign.ts#L22) | `relativeAmount` | `'0'` (numeric `0`) |  | Keep — operational. |
| [lib/workflows/actions/mailchimp/scheduleCampaign.ts:23](../../lib/workflows/actions/mailchimp/scheduleCampaign.ts#L23) | `relativeUnit` | `'hours'` |  | Keep — operational. |
| [lib/workflows/actions/mailchimp/scheduleCampaign.ts:26](../../lib/workflows/actions/mailchimp/scheduleCampaign.ts#L26) | `batchCount` | `'1'` (numeric `1`) |  | Keep — operational. |

### microsoft-excel

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/microsoft-excel/createWorkbook.ts:21](../../lib/workflows/actions/microsoft-excel/createWorkbook.ts#L21) | `worksheets` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/microsoft-excel/createWorkbook.ts:22](../../lib/workflows/actions/microsoft-excel/createWorkbook.ts#L22) | `template` | `'blank'` |  | Keep — operational. |
| [lib/workflows/actions/microsoft-excel/exportSheet.ts:21](../../lib/workflows/actions/microsoft-excel/exportSheet.ts#L21) | `filterOperator` | `'equals'` |  | Keep — read filter default. |
| [lib/workflows/actions/microsoft-excel/exportSheet.ts:24](../../lib/workflows/actions/microsoft-excel/exportSheet.ts#L24) | `sortOrder` | `'asc'` |  | Keep — read-only sort. |
| [lib/workflows/actions/microsoft-excel/exportSheet.ts:27](../../lib/workflows/actions/microsoft-excel/exportSheet.ts#L27) | `includeHeaders` | `true` |  | Keep — operational. |
| [lib/workflows/actions/microsoft-excel/exportSheet.ts:28](../../lib/workflows/actions/microsoft-excel/exportSheet.ts#L28) | `outputFormat` | `'objects'` |  | Keep — operational format. |

### microsoft-onenote

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| _(no destructured config defaults — only output-side `\|\| ''` and `\|\| 0` fallbacks; not in scope)_ |  |  |  |  |

### microsoft-outlook

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:47](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L47) | `customDays` (relative scheduling) | `1` |  | Keep — operational. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:86](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L86) | `eventTime` | `'09:00'` | ⏰ | Apply Calendar timing principle — `'09:00'` acceptable only as a visible product/config default, not hidden handler behavior. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:96](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L96) | `duration` | `'60'` | ⏰ | Keep — equivalent of Calendar's "start + 1 hour" (Outlook uses duration semantic). Document as intentional. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:110](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L110) | `customEndTime` | `'17:00'` | ⏰ | Change — fail validation if `duration='custom'` but no valid custom end time supplied. Do not silently use `'17:00'`. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:148](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L148) | `showAs` | `'busy'` | 🔓 | Keep — `'busy'` is standard meeting behavior. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:149](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L149) | `sensitivity` | `'normal'` | 🔓 | Keep — `'normal'` is standard sensitivity. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:150](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L150) | `importance` | `'normal'` |  | Keep — standard priority. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:151](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L151) | `isOnlineMeeting` | `false` | 🔓 | Keep — conservative; doesn't auto-add Teams meeting. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:152](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L152) | `onlineMeetingProvider` | `'teamsForBusiness'` | 🔓 | Keep — only applies when `isOnlineMeeting=true` (which itself defaults false). Teams is the modern/default Microsoft meeting platform. Document as intentional. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:190](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L190) | start-time fallback (invalid format) | `'09:00'` | ⏰ | Change — return `success:false` with a clear validation/config error on invalid time format. Do not silently substitute `'09:00'`. |
| [lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts:199](../../lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts#L199) | event `subject` placeholder | `'Untitled Event'` |  | Keep — placeholder. |
| [lib/workflows/actions/microsoft-outlook/sendEmail.ts:47](../../lib/workflows/actions/microsoft-outlook/sendEmail.ts#L47) | `importance` | `'normal'` | 🔓 | Keep — standard message importance. |
| [lib/workflows/actions/microsoft-outlook/sendEmail.ts:48](../../lib/workflows/actions/microsoft-outlook/sendEmail.ts#L48) | `isHtml` | `false` |  | Keep — plain text by default. |

### monday

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/monday/createBoard.ts:15](../../lib/workflows/actions/monday/createBoard.ts#L15) | `boardKind` | `'public'` | 🔓 | Require — public boards are visible to the workspace. UI recommends `'private'`; saved config must explicitly include `public`/`private`/`share`. |
| [lib/workflows/actions/monday/duplicateBoard.ts:15](../../lib/workflows/actions/monday/duplicateBoard.ts#L15) | `duplicateType` | `'duplicate_board_with_structure'` | 🔓 | Keep — operational copy mode (structure only, no items). |
| [lib/workflows/actions/monday/addFile.ts:21](../../lib/workflows/actions/monday/addFile.ts#L21) | `sourceType` | `'file'` |  | Keep — operational. |
| [lib/workflows/actions/monday/searchItems.ts:42](../../lib/workflows/actions/monday/searchItems.ts#L42) | `limit` | `25` |  | Keep — pagination cap. |
| [lib/workflows/actions/monday/listItems.ts:69](../../lib/workflows/actions/monday/listItems.ts#L69) | `limit` | `50` |  | Keep — pagination cap. |
| [lib/workflows/actions/monday/listUsers.ts:40](../../lib/workflows/actions/monday/listUsers.ts#L40) | `limit` | `50` |  | Keep — pagination cap. |
| [lib/workflows/actions/monday/listBoards.ts:43](../../lib/workflows/actions/monday/listBoards.ts#L43) | `limit` | `50` |  | Keep — pagination cap. |
| [lib/workflows/actions/monday/listUpdates.ts:49](../../lib/workflows/actions/monday/listUpdates.ts#L49) | `limit` | `25` |  | Keep — pagination cap. |
| [lib/workflows/actions/monday/addColumn.ts:179](../../lib/workflows/actions/monday/addColumn.ts#L179) | rating-column `max` (when `defaultRating` empty) | `5` |  | Keep — operational. |

### notion

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/notion.ts:410](../../lib/workflows/actions/notion.ts#L410) | search `filter` | `"page"` |  | Keep — operational. |
| [lib/workflows/actions/notion.ts:411](../../lib/workflows/actions/notion.ts#L411) | search `maxResults` | `10` |  | Keep — pagination cap. |
| [lib/workflows/actions/notion/advancedQuery.ts:66](../../lib/workflows/actions/notion/advancedQuery.ts#L66) | sort `direction` | `'descending'` |  | Keep — read-only sort. |
| [lib/workflows/actions/notion/advancedQuery.ts:75](../../lib/workflows/actions/notion/advancedQuery.ts#L75) | `pageSize` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/notion/manageBlocks.ts:86](../../lib/workflows/actions/notion/manageBlocks.ts#L86) | `pageSize` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/notion/manageBlocks.ts:103](../../lib/workflows/actions/notion/manageBlocks.ts#L103) | `depth` | `'1'` |  | Keep — operational. |
| [lib/workflows/actions/notion/manageComments.ts:108](../../lib/workflows/actions/notion/manageComments.ts#L108) | `pageSize` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/notion/getPageDetails.ts:27](../../lib/workflows/actions/notion/getPageDetails.ts#L27) | `outputFormat` | `'full'` |  | Keep — operational format. |
| [lib/workflows/actions/notion/getPages.ts:27](../../lib/workflows/actions/notion/getPages.ts#L27) | `sortDirection` | `'ascending'` |  | Keep — read-only sort. |
| [lib/workflows/actions/notion/getPages.ts:28](../../lib/workflows/actions/notion/getPages.ts#L28) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/notion/handlers.ts:833](../../lib/workflows/actions/notion/handlers.ts#L833) | `page_size` (database query) | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/notion/handlers.ts:1081](../../lib/workflows/actions/notion/handlers.ts#L1081) | `page_size` (block children) | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/notion/handlers.ts:1131](../../lib/workflows/actions/notion/handlers.ts#L1131) | `page_size` (list users) | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/notion/handlers.ts:1245](../../lib/workflows/actions/notion/handlers.ts#L1245) | `page_size` (list comments) | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/notion/handlers.ts:1283](../../lib/workflows/actions/notion/handlers.ts#L1283) | search `filter_type` | `"all"` |  | Keep — read filter. |
| [lib/workflows/actions/notion/handlers.ts:1284](../../lib/workflows/actions/notion/handlers.ts#L1284) | search `sort_direction` | `"descending"` |  | Keep — read-only sort. |
| [lib/workflows/actions/notion/handlers.ts:1285](../../lib/workflows/actions/notion/handlers.ts#L1285) | search `sort_timestamp` | `"last_edited_time"` |  | Keep — read-only sort. |
| [lib/workflows/actions/notion/handlers.ts:1286](../../lib/workflows/actions/notion/handlers.ts#L1286) | search `page_size` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/notion/handlers.ts:1339](../../lib/workflows/actions/notion/handlers.ts#L1339) | duplicate `title_suffix` | `" (Copy)"` |  | Keep — operational placeholder. |
| [lib/workflows/actions/notion/handlers.ts:2168](../../lib/workflows/actions/notion/handlers.ts#L2168) | `pageSize` (block children) | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/notion/handlers.ts:2811](../../lib/workflows/actions/notion/handlers.ts#L2811) | custom-API `method` | `'GET'` |  | Keep — safest (read-only) HTTP method default. |
| [lib/workflows/actions/notion/handlers.ts:2814](../../lib/workflows/actions/notion/handlers.ts#L2814) | custom-API `headers` | `{}` |  | Keep — empty default. |
| [lib/workflows/actions/notion/managePage.ts:593](../../lib/workflows/actions/notion/managePage.ts#L593) | `titleSuffix` | `' (Copy)'` |  | Keep — operational placeholder. |
| [lib/workflows/actions/notion/pageActions.ts:644](../../lib/workflows/actions/notion/pageActions.ts#L644) | `title_suffix` | `' (Copy)'` |  | Keep — operational placeholder. |
| [lib/workflows/actions/notion/manageDatabase.ts:177](../../lib/workflows/actions/notion/manageDatabase.ts#L177) | database `title` placeholder | `'Untitled Database'` |  | Keep — placeholder. |
| [lib/workflows/actions/registry.ts:1040](../../lib/workflows/actions/registry.ts#L1040) | comment `parent_type` | `'page'` |  | Keep — operational. |

### onedrive

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/onedrive.ts:29](../../lib/workflows/actions/onedrive.ts#L29) | `sourceType` | `'file'` |  | Keep — operational. |
| [lib/workflows/actions/onedrive/sendSharingInvitation.ts:17](../../lib/workflows/actions/onedrive/sendSharingInvitation.ts#L17) | `itemType` | `'file'` |  | Keep — operational. |
| [lib/workflows/actions/onedrive/sendSharingInvitation.ts:21](../../lib/workflows/actions/onedrive/sendSharingInvitation.ts#L21) | `role` | `'read'` | 🔓 | Keep — least-permissive useful access role (parallel to Drive `'reader'`). |
| [lib/workflows/actions/onedrive/moveItem.ts:17](../../lib/workflows/actions/onedrive/moveItem.ts#L17) | `itemType` | `'file'` |  | Keep — operational. |
| [lib/workflows/actions/onedrive/moveItem.ts:22](../../lib/workflows/actions/onedrive/moveItem.ts#L22) | `conflictBehavior` | `'rename'` |  | Keep — non-destructive (renames vs overwrite). |
| [lib/workflows/actions/onedrive/copyItem.ts:17](../../lib/workflows/actions/onedrive/copyItem.ts#L17) | `itemType` | `'file'` |  | Keep — operational. |
| [lib/workflows/actions/onedrive/copyItem.ts:22](../../lib/workflows/actions/onedrive/copyItem.ts#L22) | `conflictBehavior` | `'rename'` |  | Keep — non-destructive (renames vs overwrite). |
| [lib/workflows/actions/onedrive/searchFiles.ts:18](../../lib/workflows/actions/onedrive/searchFiles.ts#L18) | `searchType` | `'any'` |  | Keep — operational. |
| [lib/workflows/actions/onedrive/searchFiles.ts:20](../../lib/workflows/actions/onedrive/searchFiles.ts#L20) | `fileType` | `'any'` |  | Keep — operational. |
| [lib/workflows/actions/onedrive/searchFiles.ts:21](../../lib/workflows/actions/onedrive/searchFiles.ts#L21) | `maxResults` | `20` |  | Keep — pagination cap. |
| [lib/workflows/actions/onedrive/searchFiles.ts:22](../../lib/workflows/actions/onedrive/searchFiles.ts#L22) | `sortBy` | `'relevance'` |  | Keep — read-only sort. |
| [lib/workflows/actions/onedrive/deleteItem.ts:17](../../lib/workflows/actions/onedrive/deleteItem.ts#L17) | `itemType` | `'file'` |  | Keep — operational. |
| [lib/workflows/actions/onedrive/listDrives.ts:17](../../lib/workflows/actions/onedrive/listDrives.ts#L17) | `driveType` | `'all'` |  | Keep — operational. |
| [lib/workflows/actions/onedrive/renameItem.ts:17](../../lib/workflows/actions/onedrive/renameItem.ts#L17) | `itemType` | `'file'` |  | Keep — operational. |
| [lib/workflows/actions/onedrive/createSharingLink.ts:17](../../lib/workflows/actions/onedrive/createSharingLink.ts#L17) | `itemType` | `'file'` |  | Keep — operational. |
| [lib/workflows/actions/onedrive/createSharingLink.ts:20](../../lib/workflows/actions/onedrive/createSharingLink.ts#L20) | `linkType` | `'view'` | 🔓 | Keep — least-permissive vs `'edit'`/`'embed'`. |
| [lib/workflows/actions/onedrive/createSharingLink.ts:21](../../lib/workflows/actions/onedrive/createSharingLink.ts#L21) | `linkScope` | `'anonymous'` | 🔓 | Require — `'anonymous'` is too permissive for a hidden default. UI recommends least-permissive practical option (likely `'organization'` for internal flows). External-sharing workflows may need anonymous, so don't silently force a single value. |

### shopify

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/shopify/createCustomer.ts:39](../../lib/workflows/actions/shopify/createCustomer.ts#L39) | `send_welcome_email` | `false` | 🔔 | Keep — matches Shopify API default; welcome email is opt-in. Intentional. |
| [lib/workflows/actions/shopify/addOrderNote.ts:27](../../lib/workflows/actions/shopify/addOrderNote.ts#L27) | `append` | `true` |  | Keep — appends to existing note rather than replacing (non-destructive). |
| [lib/workflows/actions/shopify/updateOrderStatus.ts:29](../../lib/workflows/actions/shopify/updateOrderStatus.ts#L29) | `notify_customer` | `false` | 🔔 | Require — remove handler default. Field required at config; workflow author must explicitly choose `true` or `false` because the notification expectation depends on the status transition. |
| [lib/workflows/actions/shopify/createFulfillment.ts:31](../../lib/workflows/actions/shopify/createFulfillment.ts#L31) | `notifyCustomer` (when undefined) | `true` | 🔔 | Keep — matches Shopify convention; shipping notification is standard commerce expectation. Intentional. |

### slack

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/slack.ts:137](../../lib/workflows/actions/slack.ts#L137) | `unfurlLinks` (`!== false`) | `true` |  | Keep — Slack's own default. |
| [lib/workflows/actions/slack.ts:138](../../lib/workflows/actions/slack.ts#L138) | `unfurlMedia` (`!== false`) | `true` |  | Keep — Slack's own default. |
| [lib/workflows/actions/slack.ts:139](../../lib/workflows/actions/slack.ts#L139) | `linkNames` | `false` |  | Keep — operational. |
| [lib/workflows/actions/slack.ts:448](../../lib/workflows/actions/slack.ts#L448) | createChannel `visibility` | `'public'` | 🔓 | Require — public/private channel creation is a workspace visibility decision. UI recommends `'private'`; saved config must contain explicit visibility. |
| [lib/workflows/actions/slack.ts:457](../../lib/workflows/actions/slack.ts#L457) | createChannel `pinnedMessages` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/slack/createChannel.ts:29](../../lib/workflows/actions/slack/createChannel.ts#L29) | `isPrivate` | `false` | 🔓 | Require — same decision as `slack.ts:448 visibility`. Public/private channel creation is a workspace visibility decision; saved config must contain explicit value. |
| [lib/workflows/actions/slack/createChannel.ts:32](../../lib/workflows/actions/slack/createChannel.ts#L32) | `initialMembers` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/slack/inviteUsersToChannel.ts:22](../../lib/workflows/actions/slack/inviteUsersToChannel.ts#L22) | `sendInviteNotification` | `true` | 🔔 | Require — apply Drive Decision 2 notification principle. UI recommends `false`; saved config must include explicit value. |
| [lib/workflows/actions/slack/inviteUsersToChannel.ts:24](../../lib/workflows/actions/slack/inviteUsersToChannel.ts#L24) | `asUser` | `false` |  | Keep — operational. |
| [lib/workflows/actions/slack/deleteMessage.ts:20](../../lib/workflows/actions/slack/deleteMessage.ts#L20) | `channelType` | `'channel'` |  | Keep — operational. |
| [lib/workflows/actions/slack/deleteMessage.ts:24](../../lib/workflows/actions/slack/deleteMessage.ts#L24) | `asUser` | `true` |  | Keep — operational. |
| [lib/workflows/actions/slack/getMessages.ts:18](../../lib/workflows/actions/slack/getMessages.ts#L18) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/slack/getMessages.ts:21](../../lib/workflows/actions/slack/getMessages.ts#L21) | `includeThreads` | `false` |  | Keep — operational. |

### stripe

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/stripe/createCheckoutSession.ts:28](../../lib/workflows/actions/stripe/createCheckoutSession.ts#L28) | line-item `quantity` | `1` | 💵 | Keep — normal line-item default. |
| [lib/workflows/actions/stripe/createCheckoutSession.ts:52](../../lib/workflows/actions/stripe/createCheckoutSession.ts#L52) | `mode` | `'payment'` | 💵 | Keep — fallback after price-type auto-detection. Detected subscription/setup modes must override. Verify auto-detect logic. |
| [lib/workflows/actions/stripe/createPaymentLink.ts:27](../../lib/workflows/actions/stripe/createPaymentLink.ts#L27) | line-item `quantity` | `1` | 💵 | Keep — normal line-item default. |
| [lib/workflows/actions/stripe/listProducts.ts:20](../../lib/workflows/actions/stripe/listProducts.ts#L20) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/stripe/getCustomers.ts:18](../../lib/workflows/actions/stripe/getCustomers.ts#L18) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/stripe/getPayments.ts:18](../../lib/workflows/actions/stripe/getPayments.ts#L18) | `limit` | `100` |  | Keep — pagination cap. |
| [lib/workflows/actions/stripe/createSubscription.ts:109](../../lib/workflows/actions/stripe/createSubscription.ts#L109) | output `quantity` fallback | `1` |  | Keep — output-only fallback, not config default. |

### teams

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/teams/createGroupChat.ts:99](../../lib/workflows/actions/teams/createGroupChat.ts#L99) | `inviteExternalUsers` | `false` | 🔓 | Keep — safer default (no external invites). |
| [lib/workflows/actions/teams/createGroupChat.ts:100](../../lib/workflows/actions/teams/createGroupChat.ts#L100) | `sendInvitationEmail` | `true` | 🔔 | Require — apply Drive Decision 2 notification principle. Group chat invitation emails contact real people. UI recommends `false`; saved config must include explicit value. |
| [lib/workflows/actions/teams/addMemberToTeam.ts:89](../../lib/workflows/actions/teams/addMemberToTeam.ts#L89) | role behavior — empty `roles` array when role !== 'owner' | `[]` (member) | 🔓 | Keep — defaults to non-owner / member-level (least privilege). |

### trello

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/trello/getCards.ts:20](../../lib/workflows/actions/trello/getCards.ts#L20) | `filter` | `'open'` |  | Keep — read filter (only open cards). |
| [lib/workflows/actions/trello/getCards.ts:21](../../lib/workflows/actions/trello/getCards.ts#L21) | `limit` | `100` |  | Keep — pagination cap. |

### twitter

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/twitter/index.ts:183](../../lib/workflows/actions/twitter/index.ts#L183) | poll `duration_minutes` | `15` |  | Keep — Twitter's own poll default. |
| [lib/workflows/actions/twitter/index.ts:689](../../lib/workflows/actions/twitter/index.ts#L689) | search `max_results` | `10` |  | Keep — pagination cap. |
| [lib/workflows/actions/twitter/index.ts:749](../../lib/workflows/actions/twitter/index.ts#L749) | userTimeline `max_results` | `10` |  | Keep — pagination cap. |
| [lib/workflows/actions/twitter/index.ts:815](../../lib/workflows/actions/twitter/index.ts#L815) | mentions `max_results` | `10` |  | Keep — pagination cap. |

### utility

| File:Line | Field | Current default | Flag | User decision |
|---|---|---|---|---|
| [lib/workflows/actions/utility/transformer.ts:37](../../lib/workflows/actions/utility/transformer.ts#L37) | `language` | `'javascript'` |  | Keep — operational. |
| [lib/workflows/actions/utility/tavilySearch.ts:38](../../lib/workflows/actions/utility/tavilySearch.ts#L38) | `searchDepth` | `'basic'` |  | Keep — operational. |
| [lib/workflows/actions/utility/tavilySearch.ts:39](../../lib/workflows/actions/utility/tavilySearch.ts#L39) | `maxResults` | `5` |  | Keep — pagination cap. |
| [lib/workflows/actions/utility/tavilySearch.ts:40](../../lib/workflows/actions/utility/tavilySearch.ts#L40) | `includeAnswer` | `true` |  | Keep — operational. |
| [lib/workflows/actions/utility/tavilySearch.ts:42](../../lib/workflows/actions/utility/tavilySearch.ts#L42) | `includeDomains` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/utility/tavilySearch.ts:43](../../lib/workflows/actions/utility/tavilySearch.ts#L43) | `excludeDomains` | `[]` |  | Keep — empty default. |
| [lib/workflows/actions/utility/tavilySearch.ts:44](../../lib/workflows/actions/utility/tavilySearch.ts#L44) | `includeRawContent` | `false` |  | Keep — operational. |
| [lib/workflows/actions/utility/tavilySearch.ts:45](../../lib/workflows/actions/utility/tavilySearch.ts#L45) | `includeImages` | `false` |  | Keep — operational. |
| [lib/workflows/actions/utility/googleSearch.ts:39](../../lib/workflows/actions/utility/googleSearch.ts#L39) | `numResults` | `10` |  | Keep — pagination cap. |
| [lib/workflows/actions/utility/googleSearch.ts:40](../../lib/workflows/actions/utility/googleSearch.ts#L40) | `language` | `'en'` |  | Keep — operational. |
| [lib/workflows/actions/utility/googleSearch.ts:42](../../lib/workflows/actions/utility/googleSearch.ts#L42) | `safeSearch` | `'moderate'` | 🔓 | Keep — middle ground between `'off'` (no filter) and `'high'` (strict); matches Google's own default. |
| [lib/workflows/actions/utility/googleSearch.ts:43](../../lib/workflows/actions/utility/googleSearch.ts#L43) | `searchType` | `'web'` |  | Keep — operational. |
| [lib/workflows/actions/utility/parseFile.ts:37](../../lib/workflows/actions/utility/parseFile.ts#L37) | `csvDelimiter` | `','` |  | Keep — operational (standard CSV). |
| [lib/workflows/actions/utility/parseFile.ts:38](../../lib/workflows/actions/utility/parseFile.ts#L38) | `csvHasHeaders` | `true` |  | Keep — operational. |
| [lib/workflows/actions/utility/parseFile.ts:40](../../lib/workflows/actions/utility/parseFile.ts#L40) | `excelSheetIndex` | `0` |  | Keep — first-sheet default. |
| [lib/workflows/actions/utility/parseFile.ts:41](../../lib/workflows/actions/utility/parseFile.ts#L41) | `pdfExtractImages` | `false` |  | Keep — operational. |
| [lib/workflows/actions/utility/fileUpload.ts:31](../../lib/workflows/actions/utility/fileUpload.ts#L31) | `source` | `'upload'` |  | Keep — operational. |
| [lib/workflows/actions/utility/fileUpload.ts:35](../../lib/workflows/actions/utility/fileUpload.ts#L35) | `maxFileSize` (MB) | `10` |  | Keep — reasonable size cap. |
| [lib/workflows/actions/utility/fileUpload.ts:36](../../lib/workflows/actions/utility/fileUpload.ts#L36) | `autoDetectFormat` | `true` |  | Keep — operational. |
| [lib/workflows/actions/utility/fileUpload.ts:37](../../lib/workflows/actions/utility/fileUpload.ts#L37) | `csvDelimiter` | `','` |  | Keep — operational (standard CSV). |
| [lib/workflows/actions/utility/fileUpload.ts:38](../../lib/workflows/actions/utility/fileUpload.ts#L38) | `hasHeaders` | `true` |  | Keep — operational. |
| [lib/workflows/actions/utility/extractWebsiteData.ts:128](../../lib/workflows/actions/utility/extractWebsiteData.ts#L128) | `extractionMethod` | `'ai'` |  | Keep — operational. |
| [lib/workflows/actions/utility/extractWebsiteData.ts:132](../../lib/workflows/actions/utility/extractWebsiteData.ts#L132) | `timeout` (ms) | `30000` |  | Keep — reasonable timeout. |
| [lib/workflows/actions/utility/extractWebsiteData.ts:133](../../lib/workflows/actions/utility/extractWebsiteData.ts#L133) | `includeScreenshot` | `false` |  | Keep — operational. |
| [lib/workflows/actions/utility/extractWebsiteData.ts:134](../../lib/workflows/actions/utility/extractWebsiteData.ts#L134) | `waitForElement` | `false` |  | Keep — operational. |
| [lib/workflows/actions/utility/formatTransformer.ts:171](../../lib/workflows/actions/utility/formatTransformer.ts#L171) | `sourceFormat` | `'auto'` |  | Keep — operational. |
| [lib/workflows/actions/utility/formatTransformer.ts:172](../../lib/workflows/actions/utility/formatTransformer.ts#L172) | `targetFormat` | `'slack_markdown'` |  | Keep — operational format default. |
