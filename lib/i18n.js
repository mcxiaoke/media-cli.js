/*
 * File: i18n.js
 * Created: 2026-02-12 09:55:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 * 
 * Internationalization (i18n) System
 */

import os from "os"

// 支持的语言
export const Languages = {
  ZH_CN: 'zh-CN',
  EN_US: 'en-US'
}

// 语言资源
const resources = {
  [Languages.ZH_CN]: {
    // 通用消息
    'commands.lrmove.description': '将 RAW 目录下的 JPEG 输出文件夹移动到其他位置',
    'commands.lrmove.total.folders': '共找到 {{count}} 个 JPEG 文件夹',
    'commands.lrmove.nothing.to.do': '无需操作，中止执行。',
    'commands.lrmove.move.confirm': '确定要移动这 {{count}} 个包含文件的 JPEG 文件夹吗？',
    'commands.lrmove.moved': '已移动: {{src}} 到 {{dst}}',
    'commands.lrmove.failed': '移动失败: {{error}} {{src}} 到 {{dst}}',
    'commands.lrmove.aborted': '操作已取消，用户中止。',
    'commands.lrmove.will.do.nothing': '将不执行任何操作，已由用户中止。',
    
    // 通用操作
    'operation.completed': '操作完成: 成功 {{success}} 个, 失败 {{error}} 个',
    'operation.cancelled': '操作已取消，未执行任何更改。',
    
    // 文件操作
    'file.not.found': '文件未找到',
    'file.access.denied': '文件访问被拒绝',
    'file.already.exists': '文件已存在',
    'invalid.path': '无效的文件路径',
    'file.moved': '已移动',
    'file.failed': '失败',
    
    // 输入验证
    'input.path.empty': '输入路径不能为空',
    'input.path.not.exists': '输入路径不存在: {{path}}',
    'input.invalid': '无效输入: {{path}}',
    
    // 通用提示
    'please.check.path': '请检查文件路径是否正确',
    'please.check.permissions': '请检查文件权限',
    'use.help.for.guide': '使用 --help 查看使用指南',
    
    // 错误消息
    'error.argument': '参数错误',
    'error.processing': '处理错误',
    'error.unknown': '未知错误',
    
    // 成功消息
    'success.completed': '操作完成',
    'success.moved': '移动完成',
    
    // 状态消息
    'status.processing': '处理中...',
    'status.checking': '检查中...',
    'status.finished': '已完成',
    
    // 确认消息
    'confirm.continue': '是否继续？',
    'confirm.yes': '是',
    'confirm.no': '否',
    
    // 帮助信息
    'help.usage': '用法',
    'help.commands': '命令',
    'help.options': '选项',
    'help.examples': '示例',
    
    // 程序信息
    'app.name': 'MediaCli',
    'app.description': '多媒体文件处理工具',
    'app.copyright': '版权所有 2021-2026 @ Zhang Xiaoke'
  },
  
  [Languages.EN_US]: {
    // 通用消息
    'commands.lrmove.description': 'Move JPEG output of RAW files to other folder',
    'commands.lrmove.total.folders': 'Total {{count}} JPEG folders found',
    'commands.lrmove.nothing.to.do': 'Nothing to do, abort.',
    'commands.lrmove.move.confirm': 'Are you sure to move these {{count}} JPEG folder with files?',
    'commands.lrmove.moved': 'Moved: {{src}} to {{dst}}',
    'commands.lrmove.failed': 'Failed: {{error}} {{src}} to {{dst}}',
    'commands.lrmove.aborted': 'Will do nothing, aborted by user.',
    'commands.lrmove.will.do.nothing': 'Will do nothing, aborted by user.',
    
    // 通用操作
    'operation.completed': 'Operation completed: {{success}} success, {{error}} errors',
    'operation.cancelled': 'Operation cancelled, no changes made.',
    
    // 文件操作
    'file.not.found': 'File not found',
    'file.access.denied': 'File access denied',
    'file.already.exists': 'File already exists',
    'invalid.path': 'Invalid file path',
    'file.moved': 'Moved',
    'file.failed': 'Failed',
    
    // 输入验证
    'input.path.empty': 'Input path cannot be empty',
    'input.path.not.exists': 'Input path does not exist: {{path}}',
    'input.invalid': 'Invalid input: {{path}}',
    
    // 通用提示
    'please.check.path': 'Please check if the file path is correct',
    'please.check.permissions': 'Please check file permissions',
    'use.help.for.guide': 'Use --help for usage guide',
    
    // 错误消息
    'error.argument': 'Argument error',
    'error.processing': 'Processing error',
    'error.unknown': 'Unknown error',
    
    // 成功消息
    'success.completed': 'Operation completed',
    'success.moved': 'Move completed',
    
    // 状态消息
    'status.processing': 'Processing...',
    'status.checking': 'Checking...',
    'status.finished': 'Finished',
    
    // 确认消息
    'confirm.continue': 'Do you want to continue?',
    'confirm.yes': 'Yes',
    'confirm.no': 'No',
    
    // 帮助信息
    'help.usage': 'Usage',
    'help.commands': 'Commands',
    'help.options': 'Options',
    'help.examples': 'Examples',
    
    // 程序信息
    'app.name': 'MediaCli',
    'app.description': 'Multimedia file processing tool',
    'app.copyright': 'Copyright 2021-2026 @ Zhang Xiaoke'
  }
}

class I18n {
  constructor() {
    this.currentLanguage = this.detectLanguage()
    this.fallbackLanguage = Languages.EN_US
  }
  
  // 检测系统语言
  detectLanguage() {
    const envLang = process.env.LANG || process.env.LANGUAGE || ''
    const envLcAll = process.env.LC_ALL || ''
    
    // 优先使用环境变量
    if (envLang.includes('zh') || envLang.includes('cn') || 
        envLcAll.includes('zh') || envLcAll.includes('cn')) {
      return Languages.ZH_CN
    }
    
    // 检查是否为中文 Windows 系统
    if (process.platform === 'win32') {
      // Windows 系统下，默认使用中文
      return Languages.ZH_CN
    }
    
    // 默认为英文
    return Languages.EN_US
  }
  
  // 设置语言
  setLanguage(language) {
    if (Object.values(Languages).includes(language)) {
      this.currentLanguage = language
    }
  }
  
  // 获取当前语言
  getLanguage() {
    return this.currentLanguage
  }
  
  // 翻译文本
  t(key, params = {}) {
    let text = this.getText(key)
    
    // 替换参数
    Object.keys(params).forEach(param => {
      const placeholder = `{{${param}}}`
      text = text.replace(new RegExp(placeholder, 'g'), params[param])
    })
    
    return text
  }
  
  // 获取文本（内部方法）
  getText(key) {
    // 尝试获取当前语言的文本
    if (resources[this.currentLanguage] && resources[this.currentLanguage][key]) {
      return resources[this.currentLanguage][key]
    }
    
    // 回退到默认语言
    if (resources[this.fallbackLanguage] && resources[this.fallbackLanguage][key]) {
      return resources[this.fallbackLanguage][key]
    }
    
    // 如果都找不到，返回键名
    return key
  }
  
  // 检查是否支持中文
  isChineseSupported() {
    return this.currentLanguage === Languages.ZH_CN
  }
  
  // 强制使用中文
  useChinese() {
    this.currentLanguage = Languages.ZH_CN
  }
  
  // 强制使用英文
  useEnglish() {
    this.currentLanguage = Languages.EN_US
  }
}

// 创建全局实例
export const i18n = new I18n()

// 便捷的翻译函数
export const t = (key, params = {}) => i18n.t(key, params)