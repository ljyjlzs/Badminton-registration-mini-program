# _shared 说明

本目录存放**云函数共享模块**，部署前必须运行 `node cloudfunctions/sync-shared.js` 把 `.js` 复制到各函数目录（云函数打包不能跨目录 require）。

- `rateLimit.js` / `validate.js` / `ai.js`：会被 sync-shared.js 复制进各函数目录，函数内 `require('./rateLimit.js')` 等本地引用。
- `permissions.js` / `rating.js`：权限策略与积分算法参照实现，同样会同步，供对照审查。

**注意：**

- `weather` / `get-rankings` / `get-rules` 是故意公开的只读接口，**不要加鉴权**。
- 原调试函数（`debug-*` / `test-*` / `clear-database` 等）已于第二轮清理中全部删除，线上与本地均不再保留。
