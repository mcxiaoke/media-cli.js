import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

// 创建测试目录
const testDir = path.join('test', 'temp')
if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true })
}

// 创建测试文件
const testFile = path.join(testDir, 'test.txt')
fs.writeFileSync(testFile, '测试文件内容', 'utf8')

console.log('Testing decode command...')

// 测试1: 解码单个字符串
try {
    const result = spawnSync('node', ['index.js', 'decode', '测试'], { encoding: 'utf8' })
    if (result.status === 0) {
        console.log('✓ Test 1 passed: Decode single string')
    } else {
        console.error('✗ Test 1 failed: Decode single string')
        console.error(result.stderr)
        process.exit(1)
    }
} catch (error) {
    console.error('✗ Test 1 failed: Decode single string')
    console.error(error.message)
    process.exit(1)
}

// 测试2: 解码多个字符串
try {
    const result = spawnSync('node', ['index.js', 'decode', '测试1', '测试2', '测试3'], { encoding: 'utf8' })
    if (result.status === 0) {
        console.log('✓ Test 2 passed: Decode multiple strings')
    } else {
        console.error('✗ Test 2 failed: Decode multiple strings')
        console.error(result.stderr)
        process.exit(1)
    }
} catch (error) {
    console.error('✗ Test 2 failed: Decode multiple strings')
    console.error(error.message)
    process.exit(1)
}

// 测试3: 使用 --from-enc 和 --to-enc 选项
try {
    const result = spawnSync('node', ['index.js', 'decode', '--from-enc', 'gbk', '--to-enc', 'utf8', '测试'], { encoding: 'utf8' })
    if (result.status === 0) {
        console.log('✓ Test 3 passed: Decode with specific encodings')
    } else {
        console.error('✗ Test 3 failed: Decode with specific encodings')
        console.error(result.stderr)
        process.exit(1)
    }
} catch (error) {
    console.error('✗ Test 3 failed: Decode with specific encodings')
    console.error(error.message)
    process.exit(1)
}

// 测试4: 解码文件
try {
    const result = spawnSync('node', ['index.js', 'decode', '--files', testFile], { encoding: 'utf8' })
    if (result.status === 0) {
        console.log('✓ Test 4 passed: Decode file')
    } else {
        console.error('✗ Test 4 failed: Decode file')
        console.error(result.stderr)
        process.exit(1)
    }
} catch (error) {
    console.error('✗ Test 4 failed: Decode file')
    console.error(error.message)
    process.exit(1)
}

// 测试5: 测试 --help 选项
try {
    const result = spawnSync('node', ['index.js', 'decode', '--help'], { encoding: 'utf8' })
    if (result.status === 0) {
        console.log('✓ Test 5 passed: Help option')
    } else {
        console.error('✗ Test 5 failed: Help option')
        console.error(result.stderr)
        process.exit(1)
    }
} catch (error) {
    console.error('✗ Test 5 failed: Help option')
    console.error(error.message)
    process.exit(1)
}

// 清理测试文件
fs.unlinkSync(testFile)
fs.rmdirSync(testDir)

console.log('\n✅ All integration tests passed!')
