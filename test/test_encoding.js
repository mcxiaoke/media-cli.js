import assert from 'assert'
import * as enc from '../lib/encoding.js'

// 测试 charUnique 函数
console.log('Testing charUnique function...')
assert.strictEqual(enc.charUnique('hello'), 'helo', 'charUnique should remove duplicate characters')
assert.strictEqual(enc.charUnique('测试测试'), '测试', 'charUnique should remove duplicate Chinese characters')
assert.strictEqual(enc.charUnique(''), '', 'charUnique should handle empty string')
assert.strictEqual(enc.charUnique(123), '123', 'charUnique should handle non-string input')
console.log('✓ charUnique tests passed')

// 测试 checkBadUnicode 函数
console.log('\nTesting checkBadUnicode function...')
const badUnicodeResult = enc.checkBadUnicode('hello?')
assert.ok(badUnicodeResult.length > 0, 'checkBadUnicode should detect bad Unicode characters')

const noBadUnicodeResult = enc.checkBadUnicode('hello')
assert.strictEqual(noBadUnicodeResult.length, 0, 'checkBadUnicode should not detect bad Unicode in normal string')

const emptyResult = enc.checkBadUnicode('')
assert.strictEqual(emptyResult.length, 0, 'checkBadUnicode should handle empty string')

const nonStringResult = enc.checkBadUnicode(123)
assert.ok(Array.isArray(nonStringResult), 'checkBadUnicode should handle non-string input')
console.log('✓ checkBadUnicode tests passed')

// 测试 hasBadUnicode 函数
console.log('\nTesting hasBadUnicode function...')
assert.strictEqual(enc.hasBadUnicode('hello?'), true, 'hasBadUnicode should return true for string with bad Unicode')
assert.strictEqual(enc.hasBadUnicode('hello'), false, 'hasBadUnicode should return false for string without bad Unicode')
assert.strictEqual(enc.hasBadUnicode(''), false, 'hasBadUnicode should return false for empty string')
assert.strictEqual(enc.hasBadUnicode(123), false, 'hasBadUnicode should return false for non-string input')
console.log('✓ hasBadUnicode tests passed')

// 测试 hasBadCJKChar 函数
console.log('\nTesting hasBadCJKChar function...')
// 这里需要一个包含不良CJK字符的字符串进行测试
// 由于我们没有具体的不良CJK字符示例，这里只测试基本功能
assert.strictEqual(enc.hasBadCJKChar('hello'), false, 'hasBadCJKChar should return false for string without bad CJK characters')
assert.strictEqual(enc.hasBadCJKChar(''), false, 'hasBadCJKChar should return false for empty string')
assert.strictEqual(enc.hasBadCJKChar(123), false, 'hasBadCJKChar should return false for non-string input')
console.log('✓ hasBadCJKChar tests passed')

// 测试 getOptimizedEncodingOrder 函数
console.log('\nTesting getOptimizedEncodingOrder function...')
const encodingOrder = enc.getOptimizedEncodingOrder('测试', ['utf8', 'gbk'], ['utf8', 'gbk'])
assert.ok(Array.isArray(encodingOrder), 'getOptimizedEncodingOrder should return an array')
assert.ok(encodingOrder.length > 0, 'getOptimizedEncodingOrder should return non-empty array')

const nonStringOrder = enc.getOptimizedEncodingOrder(123, ['utf8', 'gbk'], ['utf8', 'gbk'])
assert.ok(Array.isArray(nonStringOrder), 'getOptimizedEncodingOrder should handle non-string input')

const nonArrayOrder = enc.getOptimizedEncodingOrder('测试', 'utf8', 'gbk')
assert.ok(Array.isArray(nonArrayOrder), 'getOptimizedEncodingOrder should handle non-array encoding inputs')
console.log('✓ getOptimizedEncodingOrder tests passed')

// 测试 tryDecodeText 函数
console.log('\nTesting tryDecodeText function...')
const decodeResult = enc.tryDecodeText('测试')
assert.ok(Array.isArray(decodeResult), 'tryDecodeText should return an array')
assert.ok(decodeResult.length > 0, 'tryDecodeText should return non-empty array')

const emptyDecodeResult = enc.tryDecodeText('')
assert.ok(Array.isArray(emptyDecodeResult), 'tryDecodeText should handle empty string')

const nonStringDecodeResult = enc.tryDecodeText(123)
assert.ok(Array.isArray(nonStringDecodeResult), 'tryDecodeText should handle non-string input')
console.log('✓ tryDecodeText tests passed')

// 测试 decodeText 函数
console.log('\nTesting decodeText function...')
const bestDecodeResult = enc.decodeText('测试')
assert.ok(Array.isArray(bestDecodeResult), 'decodeText should return an array')
assert.ok(bestDecodeResult.length > 0, 'decodeText should return non-empty array')
console.log('✓ decodeText tests passed')

console.log('\n✅ All tests passed!')
