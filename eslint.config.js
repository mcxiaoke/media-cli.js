// eslint.config.js - ESLint v9+ 新格式配置
import eslint from "@eslint/js"
import prettierConfig from "eslint-config-prettier"
import prettierPlugin from "eslint-plugin-prettier"
import nodeGlobals from "globals"

// 整合 Prettier 规则（ESLint v9+ 需手动组合规则）
const prettierRules = {
    ...prettierConfig.rules,
    "prettier/prettier": "off",
}

export default [
    // 1. 基础 ESLint 推荐规则
    eslint.configs.recommended,

    // 2. Node.js 环境配置（启用 Node 全局变量）
    {
        languageOptions: {
            globals: {
                ...nodeGlobals.node, // 包含 require、module、__dirname 等 Node 全局变量
                es2021: true,
            },
            ecmaVersion: "latest",
            sourceType: "module", // 如果是 CommonJS 项目，改为 'script'
        },
        // 自定义规则（优先级高于默认规则）
        rules: {
            "no-useless-assignment": "off", // 允许无用的赋值（如 a = a）
            "no-console": "off", // 允许使用 console.log
            "no-unused-vars": "off", // 未使用变量仅警告，忽略下划线开头的变量
            "no-empty": "off", // 允许空块（如 catch 块）
            "no-fallthrough": "off", // 允许 switch case 穿透
            "no-prototype-builtins": "off", // 允许直接调用 hasOwnProperty 等原型方法
        },
    },

    // 3. Prettier 集成配置（禁用冲突规则 + 启用 Prettier 规则）
    {
        plugins: {
            prettier: prettierPlugin,
        },
        rules: prettierRules,
    },

    // 4. 忽略文件（替代原来的 .eslintignore）
    {
        ignores: [
            "node_modules/**",
            "dist/**",
            "test/**",
            "coverage/**",
            "*.log",
            "**/node_modules/*",
        ],
    },
]
