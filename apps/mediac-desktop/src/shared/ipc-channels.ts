export const IPC_CHANNELS = {
  APP_GET_VERSION: "app:get-version",
  ENV_GET: "env:get",
  DIALOG_SELECT_FILES: "dialog:select-files",
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
