# 羽毛球报名小程序

> 入口见仓库根 [README.md](../README.md)

## 目录

| 子目录 | 说明 |
|---|---|
| `cloudfunctions/` | 54 个云函数（Node.js） |
| `miniprogram/` | 微信小程序前端 |
| `scripts/` | 构建/检查/发布脚本 |
| `docs/` | 项目文档 |
| `cloudbaserc.json` | 云函数清单（根清单，54 条） |

## 常用命令

```bash
# 一致性检查（根 / 子 cloudbaserc 对齐）
node scripts/check-fn-consistency.js

# 静态检查
node scripts/check-static.js

# 同步共享模块到各云函数
node cloudfunctions/sync-shared.js

# 小程序上传（需先开微信开发者工具服务端口）
# 详见 docs/发布记录.md
```

## 文档

| 文档 | 路径 |
|---|---|
| 开发记录 | [DEVELOPMENT.md](DEVELOPMENT.md) |
| 发布指南 | [RELEASE.md](RELEASE.md) |
| 云函数与 Java 对齐 | [../docs/云函数与Java对齐说明.md](../docs/云函数与Java对齐说明.md) |
| 发布记录（含上传留痕） | [docs/发布记录.md](docs/发布记录.md) |
