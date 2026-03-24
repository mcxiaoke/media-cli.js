/*
 * File: test_remove_command.js
 * Created: 2026-03-23
 * Author: mcxiaoke
 * License: Apache License 2.0
 */

import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, it, before, after } from 'node:test'
import inquirer from 'inquirer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
import { builder, handler } from '../cmd/cmd_remove.js'

const testDir = path.join(__dirname, 'test_remove')
const testFile1 = path.join(testDir, 'test1.txt')
const testFile2 = path.join(testDir, 'test2.txt')
const testFile3 = path.join(testDir, 'test3.txt')

describe('remove command', () => {
  before(async () => {
    // 创建测试目录和文件
    await fs.ensureDir(testDir)
    await fs.writeFile(testFile1, 'test content 1')
    await fs.writeFile(testFile2, 'test content 2')
    await fs.writeFile(testFile3, 'test content 3')
  })

  after(async () => {
    // 清理测试目录
    await fs.remove(testDir)
  })

  it('should parse command line options correctly', () => {
    const yargs = {}
    const result = builder(yargs, false)
    assert.ok(result)
    // 测试是否添加了所有必要的选项
    assert.ok(result.option)
  })

  it('should handle invalid input path', async () => {
    const invalidPath = path.join(testDir, 'non_existent_dir')
    try {
      await handler({ input: invalidPath, doit: false })
      assert.fail('Should throw an error for invalid input path')
    } catch (error) {
      assert.ok(error)
      assert.ok(error.message.includes('Invalid Input'))
    }
  })

  it('should require at least one condition', async () => {
    try {
      await handler({ input: testDir, doit: false })
      assert.fail('Should throw an error for missing conditions')
    } catch (error) {
      assert.ok(error)
      assert.ok(error.message.includes('required conditions'))
    }
  })

  it('should filter files by pattern', async () => {
    const mockLog = []
    const originalShow = console.log
    const originalPrompt = inquirer.prompt
    console.log = (msg) => mockLog.push(msg)
    inquirer.prompt = async () => ({ yes: false }) // 模拟用户输入 no

    try {
      await handler({
        input: testDir,
        pattern: 'test1',
        doit: false
      })
      // 检查是否找到了匹配的文件
      const hasMatch = mockLog.some(msg => msg.includes('test1.txt'))
      assert.ok(hasMatch)
    } finally {
      console.log = originalShow
      inquirer.prompt = originalPrompt
    }
  })

  it('should handle dry run mode', async () => {
    const mockLog = []
    const originalShow = console.log
    const originalPrompt = inquirer.prompt
    console.log = (msg) => mockLog.push(msg)
    inquirer.prompt = async () => ({ yes: false }) // 模拟用户输入 no

    try {
      await handler({
        input: testDir,
        pattern: 'test1',
        doit: false
      })
      // 检查是否显示了测试模式的提示
      const hasTestModeMsg = mockLog.some(msg => msg.includes('TEST MODE'))
      assert.ok(hasTestModeMsg)
    } finally {
      console.log = originalShow
      inquirer.prompt = originalPrompt
    }
  })

  it('should handle file size filter', async () => {
    const mockLog = []
    const originalShow = console.log
    const originalPrompt = inquirer.prompt
    console.log = (msg) => mockLog.push(msg)
    inquirer.prompt = async () => ({ yes: false }) // 模拟用户输入 no

    try {
      await handler({
        input: testDir,
        sizel: 0,
        sizer: 100,
        doit: false
      })
      // 检查是否找到了匹配大小的文件
      const hasSizeMatch = mockLog.some(msg => msg.includes('Size='))
      assert.ok(hasSizeMatch)
    } finally {
      console.log = originalShow
      inquirer.prompt = originalPrompt
    }
  })

  it('should handle time filter', async () => {
    const mockLog = []
    const originalShow = console.log
    const originalPrompt = inquirer.prompt
    console.log = (msg) => mockLog.push(msg)
    inquirer.prompt = async () => ({ yes: false }) // 模拟用户输入 no

    try {
      await handler({
        input: testDir,
        mtime: '7d',
        doit: false
      })
      // 检查是否找到了匹配时间的文件
      const hasTimeMatch = mockLog.some(msg => msg.includes('Time='))
      assert.ok(hasTimeMatch)
    } finally {
      console.log = originalShow
      inquirer.prompt = originalPrompt
    }
  })
})
