// eslint.config.js - ESLint v9+ 新格式配置
import eslint from "@eslint/js"
import prettierConfig from "eslint-config-prettier"
import prettierPlugin from "eslint-plugin-prettier"
import nodeGlobals from "globals"

// 整合 Prettier 规则（ESLint v9+ 需手动组合规则）
// 说明：此前 "prettier/prettier" 被设为 "off"，导致插件与配置形同负担：
// 仓库里 14 个文件不符合 .prettierrc 却不会被任何门禁发现。
// 这里改为 "warn"——先让差异可见、不阻断构建，待全量格式化后可视情况收紧为 "error"。
const prettierRules = {
    ...prettierConfig.rules,
    "prettier/prettier": "warn",
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
            // 此前 no-unused-vars / no-empty / no-fallthrough / no-prototype-builtins
            // 被整体关闭，直接导致约 20 个文件保留未使用的 import 而不被提示，
            // 也让静默 catch 块无法被发现。这里恢复为 error。
            "no-unused-vars": [
                "error",
                {
                    args: "after-used",
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    // catch 参数未使用是常见且有意为之的写法（保留原始错误便于调试），
                    // 不因它产生噪音；真正需要关注的是未使用的 import 与局部变量。
                    caughtErrors: "none",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "no-empty": ["error", { allowEmptyCatch: false }],
            "no-fallthrough": "error",
            "no-prototype-builtins": "error",
            "no-useless-assignment": "error",
            "no-console": "off", // CLI 工具的输出属正常交付内容
            "no-undef": "error",
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
            "**/node_modules/*",
            "dist/**",
            "coverage/**",
            "*.log",
            // temp/ 存放修复前的代码备份与中间产物，不是产品代码，
            // 其中的"问题"是刻意保留的历史快照，不应计入门禁。
            "temp/**",
            // labs/ 为实验性脚本，未纳入 npm files，单独维护
            "labs/**",
            // data/、assets/、output/、test/temp 为数据与运行产物
            "data/**",
            "assets/**",
            "output/**",
            "test/temp/**",
        ],
    },
]
