// Whitelist of tenant column keys that /wren config set is allowed to write.
// Secrets (erlc_server_key_enc, pow_token_enc, owner_discord_id) MUST go through
// the typed subcommands so they're encrypted / validated before write.
export const SETTABLE_KEYS = new Set([
  'displayName',
  'botDisplayName',
  'inGameHandle',
  'prcBaseUrl',
  'powBaseUrl',
  'powServerAId',
  'powServerBId',
  'ticketCategoryId',
  'securityRoleId',
  'ticketParentId',
  'statusChannelId',
  'erlcLogChannelId',
  'inGamePmLogId',
  'raidAlertChannel',
  'raidAlertRole',
  'coreInfo',
  'responseStyle',
  'raidAutoPunish',
]);

export const SETTABLE_KEYS_FOR_TEST = SETTABLE_KEYS;
