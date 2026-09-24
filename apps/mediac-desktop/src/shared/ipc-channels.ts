export const IPC_CHANNELS = {
  APP_GET_VERSION: "app:get-version",
  ENV_GET: "env:get",
  DIALOG_SELECT_FILES: "dialog:select-files",
  PLAN_CREATE: "plan:create",
  EXECUTION_START: "execution:start",
  EXECUTION_STOP: "execution:stop",
  EXECUTION_SNAPSHOT: "execution:snapshot",
  EXECUTION_EVENT: "execution:event",
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
