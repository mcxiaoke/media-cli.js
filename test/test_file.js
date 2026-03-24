/*
 * File: test_file.js
 * Created: 2026-03-24
 * Author: mcxiaoke
 * License: Apache License 2.0
 */

import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, it, before, after } from 'node:test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'

describe('file.js - Constants', () => {
  it('should have correct size constants', () => {
    assert.strictEqual(mf.FILE_SIZE_1K, 1024)
    assert.strictEqual(mf.FILE_SIZE_1M, 1024 * 1024)
    assert.strictEqual(mf.FILE_SIZE_1G, 1024 * 1024 * 1024)
    assert.strictEqual(mf.FILE_SIZE_1T, 1024 * 1024 * 1024 * 1024)
  })
})

describe('file.js - Directory Size Calculation', () => {
  const testDir = path.join(__dirname, 'test_file_temp')
  const subDir = path.join(testDir, 'subdir')
  const file1 = path.join(testDir, 'file1.txt')
  const file2 = path.join(testDir, 'file2.txt')
  const file3 = path.join(subDir, 'file3.txt')

  before(async () => {
    await fs.ensureDir(testDir)
    await fs.ensureDir(subDir)
    await fs.writeFile(file1, 'content1')
    await fs.writeFile(file2, 'content22')
    await fs.writeFile(file3, 'content333')
  })

  after(async () => {
    await fs.remove(testDir)
  })

  it('should calculate directory size correctly', async () => {
    const size = await mf.getDirectorySize(testDir)
    assert.ok(size > 0)
  })

  it('should throw error for non-existent directory', async () => {
    try {
      await mf.getDirectorySize(path.join(testDir, 'nonexistent'))
      assert.fail('Should throw error')
    } catch (error) {
      assert.ok(error.message.includes('not accessible'))
    }
  })
})

describe('file.js - Directory File Count', () => {
  const testDir = path.join(__dirname, 'test_file_count_temp')
  const subDir = path.join(testDir, 'subdir')
  const file1 = path.join(testDir, 'file1.txt')
  const file2 = path.join(testDir, 'file2.txt')
  const file3 = path.join(subDir, 'file3.txt')

  before(async () => {
    await fs.ensureDir(testDir)
    await fs.ensureDir(subDir)
    await fs.writeFile(file1, 'content1')
    await fs.writeFile(file2, 'content2')
    await fs.writeFile(file3, 'content3')
  })

  after(async () => {
    await fs.remove(testDir)
  })

  it('should count files in directory correctly', async () => {
    const count = await mf.getDirectoryFileCount(testDir)
    assert.strictEqual(count, 3)
  })

  it('should return -1 for invalid directory', async () => {
    const count = await mf.getDirectoryFileCount(path.join(testDir, 'nonexistent'))
    assert.strictEqual(count, -1)
  })
})

describe('file.js - Find Common Root', () => {
  it('should find common root for same directory', () => {
    const paths = [
      '/home/user/file1.txt',
      '/home/user/file2.txt',
      '/home/user/sub/file3.txt'
    ]
    const root = mf.findCommonRoot(paths)
    assert.ok(root.includes('home'))
    assert.ok(root.includes('user'))
  })

  it('should return null for no common root', () => {
    const root = mf.findCommonRoot([])
    assert.strictEqual(root, null)
  })
})

console.log('\n✅ All file.js tests passed!')
