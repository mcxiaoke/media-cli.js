/** 主进程菜单 -> 渲染进程的单向动作通道（不经过 invoke，无需信任校验） */
export const MENU_ACTION_CHANNEL = "menu:action"

/**
 * 菜单动作字串的唯一事实源。
 * 主进程与渲染进程必须同时引用这里，避免 "add-dir" / "add-directory" 一类拼写漂移。
 */
export const MENU_ACTIONS = {
  ADD_FILES: "add-files",
  ADD_DIRECTORY: "add-directory",
  OPEN_OUTPUT_DIR: "open-output-dir",
  CREATE_PLAN: "create-plan",
  START_EXECUTION: "start-execution",
  STOP_EXECUTION: "stop-execution",
  CLEAR_TASKS: "clear-tasks",
  TOGGLE_SIDEBAR: "toggle-sidebar",
  TOGGLE_LOG: "toggle-log",
  TOGGLE_THEME: "toggle-theme",
  OPEN_SETTINGS: "open-settings",
} as const

export type MenuAction = (typeof MENU_ACTIONS)[keyof typeof MENU_ACTIONS]

export const IPC_CHANNELS = {
  APP_GET_VERSION: "app:get-version",
  ENV_GET: "env:get",
  DIALOG_SELECT_FILES: "dialog:select-files",
  STAGE_INPUTS: "ffmpeg:stage-inputs",
  PLAN_CREATE: "plan:create",
  EXECUTION_START: "execution:start",
  EXECUTION_STOP: "execution:stop",
  EXECUTION_SNAPSHOT: "execution:snapshot",
  EXECUTION_EVENT: "execution:event",
  SYSTEM_SHOW_IN_FOLDER: "system:show-in-folder",
  SYSTEM_OPEN_PATH: "system:open-path",
  SYSTEM_NOTIFY: "system:notify",
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
