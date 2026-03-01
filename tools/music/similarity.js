/**
 * 字符串相似度检测模块（余弦相似度算法）
 * @module similarity
 */

/**
 * 计算两个字符串的余弦相似度
 * @param {string} str1 - 第一个字符串
 * @param {string} str2 - 第二个字符串
 * @returns {number} 相似度值（0-1，1为完全相同）
 */
export function calculateSimilarity(str1, str2) {
  // 统一转为小写，忽略大小写差异
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  // 如果两个字符串完全相同，直接返回1
  if (s1 === s2) return 1.0;

  // 构建字符频率映射
  const charMap = new Map();
  for (const char of s1) {
    charMap.set(char, (charMap.get(char) || 0) + 1);
  }

  const charMap2 = new Map();
  for (const char of s2) {
    charMap2.set(char, (charMap2.get(char) || 0) + 1);
  }

  // 获取所有唯一字符
  const allChars = new Set([...charMap.keys(), ...charMap2.keys()]);

  // 构建向量
  let vector1 = [];
  let vector2 = [];
  for (const char of allChars) {
    vector1.push(charMap.get(char) || 0);
    vector2.push(charMap2.get(char) || 0);
  }

  // 计算余弦相似度
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (let i = 0; i < vector1.length; i++) {
    dotProduct += vector1[i] * vector2[i];
    norm1 += vector1[i] * vector1[i];
    norm2 += vector2[i] * vector2[i];
  }

  // 避免除以0
  if (norm1 === 0 || norm2 === 0) return 0;

  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * 筛选超过阈值的相似字符串对
 * @param {string[]} strings - 待检测的字符串数组
 * @param {number} threshold - 相似度阈值（0-1）
 * @returns {Array<{str1: string, str2: string, similarity: number}>} 相似字符串对列表
 */
export function findSimilarPairs(strings, threshold) {
  const results = [];
  // 去重并避免重复对比（i<j）
  const uniqueStrings = [...new Set(strings)];
  
  for (let i = 0; i < uniqueStrings.length; i++) {
    for (let j = i + 1; j < uniqueStrings.length; j++) {
      const sim = calculateSimilarity(uniqueStrings[i], uniqueStrings[j]);
      if (sim >= threshold) {
        results.push({
          str1: uniqueStrings[i],
          str2: uniqueStrings[j],
          similarity: parseFloat(sim.toFixed(4)) // 保留4位小数
        });
      }
    }
  }

  // 按相似度降序排序
  return results.sort((a, b) => b.similarity - a.similarity);
}