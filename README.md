# 销售广告中台

静态运营看板，包含：

- 月度广告数据复盘
- 无效低效看板
- 领星规则看板
- 批量投放看板

页面默认读取 `data/sales_ads_dashboard_data.json`。前端与数据处理脚本解耦，后续迁移公司内网或接入 API 时，只需修改 `assets/config.js` 中的数据地址。

领星规则沿用统一清洗CSV生成的触发监控、专项和动作明细，不计算理论节费或规则有效性；库存条件暂停、来货自动重开进入专项，不混入普通暂停。8901 的逐条触发CSV与后续服务器分析流程独立，本项目不取领星日报。

无效低效页面的已节约、预计节约卡片及节约花费视角保留，使用该模块自己的源表，不受领星规则删除理论节费的要求影响。周报月报入口不再展示，月度广告数据复盘继续保留。

批量页面显示“负责人”，保留一个品类多个负责人的批量分子；覆盖率、花费占比、销售贡献率均用整品类（批量和非批量）作分母，不表示负责人自己负责范围内的覆盖率。同月同品类的分母按 `denominator_key` 去重，跨月则分别累计。单负责人品类沿用品类汇总值，多负责人品类按实际批次拆分批量分子；不修正源表汇总和批次表之间已确认接受的数量差异。BS项目部沿用原看板范围排除。批量 ACoS 差值为“批量 ACoS - 品类平均 ACoS”，正值表示批量更高。

SB/SD读取最新月度工作表，支持品类汇总或广告活动明细；按品类汇总花费、销售额后计算加权ACoS，图表与表格使用同一数据，不再固定8月截图。

## 本地预览

在项目目录运行：

```bash
python3 -m http.server 8765
```

浏览器打开：

```text
http://127.0.0.1:8765/
```

## 更新数据

先在销售中台输入文件目录运行统一数据脚本：

```bash
cd ~/Desktop/Codex销售中台输入文件
python3 build_sales_ads_dashboard_data.py --refresh-lingxing --copy-module-json
```

然后用新生成的文件覆盖：

```text
data/sales_ads_dashboard_data.json
```

本机生成结果位于输入文件夹的 `前端数据/`。`--refresh-lingxing` 将规则处理目录里已准备好的两份规则JSON合并进总JSON；不传此选项会保留旧总JSON里的规则部分。发布时只同步网页资源和总JSON，不上传原始Excel、触发CSV、cURL或凭据。桌面预览的 `assets/config.js` 使用 `前端数据/`，GitHub Pages 使用 `data/`，不要互相覆盖。

## GitHub Pages

该项目不需要构建工具。将整个目录推送到 GitHub 仓库后，在仓库设置中选择：

```text
Settings -> Pages -> Deploy from a branch -> main / root
```

页面发布后，GitHub Pages 会直接提供 `index.html`、`assets/` 和 `data/`。

## 内网/API 迁移

将 `assets/config.js` 改为公司接口地址：

```js
window.DASHBOARD_DATA_URL = "/api/sales-ads-dashboard";
```

接口返回结构保持与当前统一 JSON 一致，页面代码无需改动。

## 本地校验

```bash
node --check assets/app.js
```
