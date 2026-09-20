/*
 * File: test_helper.js
 * Created: 2026-03-24
 * Author: mcxiaoke
 * License: Apache License 2.0
 */

import assert from 'assert'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, it, before, after } from 'node:test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import * as helper from '../lib/helper.js'

describe('helper.js - File Type Detection', () => {
  it('should detect image files correctly', () => {
    assert.ok(helper.isImageFile('test.jpg'))
    assert.ok(helper.isImageFile('test.png'))
    assert.ok(helper.isImageFile('test.jpeg'))
    assert.ok(helper.isImageFile('test.webp'))
    assert.ok(helper.isImageFile('test.heic'))
    assert.ok(!helper.isImageFile('test.txt'))
    assert.ok(!helper.isImageFile('test.mp4'))
  })

  it('should detect video files correctly', () => {
    assert.ok(helper.isVideoFile('test.mp4'))
    assert.ok(helper.isVideoFile('test.mov'))
    assert.ok(helper.isVideoFile('test.avi'))
    assert.ok(helper.isVideoFile('test.mkv'))
    assert.ok(!helper.isVideoFile('test.jpg'))
    assert.ok(!helper.isVideoFile('test.mp3'))
  })

  it('should detect audio files correctly', () => {
    assert.ok(helper.isAudioFile('test.mp3'))
    assert.ok(helper.isAudioFile('test.wav'))
    assert.ok(helper.isAudioFile('test.flac'))
    assert.ok(helper.isAudioFile('test.m4a'))
    assert.ok(!helper.isAudioFile('test.jpg'))
    assert.ok(!helper.isAudioFile('test.mp4'))
  })

  it('should detect archive files correctly', () => {
    assert.ok(helper.isArchiveFile('test.zip'))
    assert.ok(helper.isArchiveFile('test.rar'))
    assert.ok(helper.isArchiveFile('test.7z'))
    assert.ok(!helper.isArchiveFile('test.jpg'))
    assert.ok(!helper.isArchiveFile('test.txt'))
  })

  it('should get correct file type by extension', () => {
    assert.strictEqual(helper.getFileTypeByExt('test.jpg'), helper.FILE_TYPE_IMAGE)
    assert.strictEqual(helper.getFileTypeByExt('test.mp4'), helper.FILE_TYPE_VIDEO)
    assert.strictEqual(helper.getFileTypeByExt('test.mp3'), helper.FILE_TYPE_AUDIO)
    assert.strictEqual(helper.getFileTypeByExt('test.zip'), helper.FILE_TYPE_ARCHIVE)
    assert.strictEqual(helper.getFileTypeByExt('test.epub'), helper.FILE_TYPE_BOOK)
    assert.strictEqual(helper.getFileTypeByExt('test.unknown'), helper.FILE_TYPE_DEFAULT)
  })
})

describe('helper.js - Path Utilities', () => {
  it('should get file extension correctly', () => {
    assert.strictEqual(helper.pathExt('test.jpg'), '.jpg')
    assert.strictEqual(helper.pathExt('TEST.PNG'), '.png')
    assert.strictEqual(helper.pathExt('test.JPG', false), '.JPG')
    assert.strictEqual(helper.pathExt('path/to/file.mp4'), '.mp4')
    assert.strictEqual(helper.pathExt('file'), '')
  })

  it('should split path into parts correctly', () => {
    const [dir, name, ext] = helper.pathSplit('/path/to/file.txt')
    assert.ok(dir.includes('path'))
    assert.strictEqual(name, 'file')
    assert.strictEqual(ext, '.txt')
  })

  it('should calculate unicode length correctly', () => {
    assert.strictEqual(helper.unicodeLength('abc'), 3)
    assert.strictEqual(helper.unicodeLength('中文'), 4)
    assert.strictEqual(helper.unicodeLength('a中b文'), 6)
  })
})

describe('helper.js - String Utilities', () => {
  it('should escape regex special characters', () => {
    assert.strictEqual(helper.escapeRegExp('test.*+?^${}()|[]\\'), 'test\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\')
  })

  it('should replace all occurrences', () => {
    assert.strictEqual(helper.replaceAll('test test test', 'test', 'replace'), 'replace replace replace')
    assert.strictEqual(helper.replaceAll('a.b.c', '.', '-'), 'a-b-c')
  })
})

describe('helper.js - Formatting Utilities', () => {
  it('should format human readable size', () => {
    assert.ok(helper.humanSize(1024).includes('kB'))
    assert.ok(helper.humanSize(1024 * 1024).includes('MB'))
    assert.ok(helper.humanSize(0).includes('B'))
  })

  it('should format bytes correctly', () => {
    assert.ok(helper.formatBytes(1024).includes('KB'))
    assert.ok(helper.formatBytes(1024 * 1024).includes('MB'))
  })

  it('should format duration correctly', () => {
    assert.ok(helper.humanDuration(500).includes('ms'))
    assert.ok(helper.humanDuration(65000).includes('m'))
    assert.ok(helper.humanDuration(3661000).includes('h'))
  })
})

describe('helper.js - Hash Utilities', () => {
  it('should generate text hash', () => {
    const hash1 = helper.textHash('test')
    const hash2 = helper.textHash('test')
    const hash3 = helper.textHash('different')
    assert.strictEqual(hash1, hash2)
    assert.notStrictEqual(hash1, hash3)
  })

  it('should generate text hash MD5', () => {
    const hash1 = helper.textHashMD5('test')
    const hash2 = helper.textHashMD5('test')
    const hash3 = helper.textHashMD5('different')
    assert.strictEqual(hash1, hash2)
    assert.notStrictEqual(hash1, hash3)
  })
})

describe('helper.js - File System Utilities', () => {
  const testDir = path.join(__dirname, 'test_helper_temp')
  const testFile1 = path.join(testDir, 'file1.txt')
  const testFile2 = path.join(testDir, 'file2.txt')

  before(async () => {
    await fs.ensureDir(testDir)
    await fs.writeFile(testFile1, 'content1')
    await fs.writeFile(testFile2, 'content2')
  })

  after(async () => {
    await fs.remove(testDir)
  })

  it('should check if files are exact same', async () => {
    const same = await helper.isExactSameFile(testFile1, testFile1)
    assert.ok(same)
    const different = await helper.isExactSameFile(testFile1, testFile2)
    assert.ok(!different)
  })

  // 回归测试：回收站必须位于用户目录下。
  // 旧实现是「源文件所在磁盘的根目录」（如 C:\Deleted_By_Mediac），
  // 非管理员账户在盘根建目录会 EACCES，进而触发"删除失败却计成功"的静默数据残留。
  it('should place safe-deleted dir under user home', () => {
    const dir = helper.getSafeDeletedDir(testFile1)
    const home = path.resolve(os.homedir())
    assert.ok(dir.startsWith(home), `expected under ${home}, got ${dir}`)
    assert.ok(!path.parse(dir).root.includes('Deleted_By_Mediac'))
    // 路径中不应再出现盘根式的 Deleted_By_Mediac
    assert.ok(!dir.includes('Deleted_By_Mediac'))
  })

  // 回归测试：safeRemove 失败必须返回 null（而非静默返回 undefined 被当成成功）
  it('should return null when safeRemove fails', async () => {
    const missing = path.join(testDir, 'does-not-exist.txt')
    const result = await helper.safeRemove(missing)
    assert.strictEqual(result, null)
  })

  // 回归测试：曾因字符类中写成 \\s（字面反斜杠+s）导致所有小写字母 s 被删除
  it('should keep lowercase letter s in filenames', () => {
    assert.strictEqual(helper.filenameSafe('test.jpg'), 'test.jpg')
    assert.strictEqual(helper.filenameSafe('Personal Notes.txt'), 'PersonalNotes.txt')
    assert.strictEqual(helper.filenameSafe('photos/album.jpg'), 'photosalbum.jpg')
  })

  it('should still strip illegal filename characters', () => {
    assert.strictEqual(helper.filenameSafe('a<b>c.jpg'), 'abc.jpg')
    assert.strictEqual(helper.filenameSafe('a:b*c?.jpg'), 'abc.jpg')
  })

  // 回归测试：曾因 slice(limit) 反向截断返回 24 位
  it('should truncate md5 hash to requested length', () => {
    const short = helper.textHashMD5('abc', 'md5', 8)
    assert.strictEqual(short.length, 8)
  })
})

console.log('\n✅ All helper.js tests passed!')
