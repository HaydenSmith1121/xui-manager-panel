# X-UI Manager Panel

一个轻量的 X-UI/3X-UI 聚合订阅管理面板。管理员在后台配置套餐、X-UI 面板、节点和倍率；用户注册后选择套餐，管理员审核通过后自动获得 Clash 订阅链接。订阅响应会带 `Subscription-Userinfo`，Clash Verge 可以显示总量、已用、剩余和到期时间。

## 功能

- 用户注册、登录、套餐选择、等待管理员审核
- 管理员创建套餐：总量、有效期、允许节点标签、是否需要审核
- 管理员创建 X-UI 面板配置：面板地址、账号、密码、订阅地址
- 管理员创建节点：节点名、分享链接、标签、倍率、X-UI 入站 ID
- Clash 订阅生成：`/sub/clash/<token>`
- 动态用量同步：从 X-UI `/panel/api/inbounds/list` 读取 `clientStats`
- 手动用量录入：适合先测试或没有独立 client 的场景

## 重要说明

不要把服务器密码、X-UI 面板密码写进 GitHub。部署后在网页后台填写面板信息，密码只保存在服务器本机 SQLite 数据库里。

动态用量统计需要满足一个条件：X-UI 里面每个用户都有独立 client，并且 client 的 `email` 等于本系统用户注册邮箱。多个用户共用同一个 VLESS/Trojan client 时，X-UI 无法区分每个人用了多少流量。

## 一键部署

在服务器 SSH 里执行：

```bash
export ADMIN_EMAIL='你的管理员邮箱'
export ADMIN_PASSWORD='你的管理员密码'
bash <(curl -fsSL https://raw.githubusercontent.com/HaydenSmith1121/xui-manager-panel/main/deploy/install.sh)
```

安装完成后打开：

```text
http://服务器IP:25888/
```

如果不设置 `ADMIN_PASSWORD`，脚本会随机生成一个管理员密码，并在安装输出里显示。

## 后台使用

1. 用安装时设置的管理员邮箱和密码登录。
2. 打开“配置”，在“新建套餐”表单创建套餐，例如 `1000G 月付`、总量 `1000`、有效天数 `30`。需要继续添加时点击右上角“新建”，每次都会新增一条记录。
3. 在“新建 X-UI 面板”表单添加面板。面板地址填写完整地址，例如 `https://你的域名:端口/随机路径/`。列表里的“编辑”只修改当前记录；退出编辑或添加下一条时先点击“新建”。
4. 打开“节点”，添加节点。
5. `分享链接` 粘贴 X-UI 生成的 `vless://...` 或 `trojan://...`。
6. `倍率` 填 `1`、`3`、`0.5` 等；实际用 1GB，倍率 3 会按 3GB 计费。
7. `标签` 用英文逗号分隔，例如 `us,premium`。套餐允许标签为空代表可用全部节点。
8. `X-UI 入站 ID` 填 X-UI 入站的 ID；不填或填 `0` 时，会尝试用节点名称匹配 X-UI 入站 remark。
9. 用户注册并选择套餐后，到“后台”页面点击“通过”。
10. 用户登录后复制 Clash 订阅链接导入 Clash Verge；使用结束后可在左下角点击“退出登录”。

## 动态用量同步

进入“后台”，点击“同步 X-UI 用量”。系统会登录每个启用的 X-UI 面板，读取入站里的 `clientStats`，找到邮箱匹配的用户并更新用量。

同步失败时，先检查：

- 面板地址是否包含随机路径，并以 `/` 结尾
- 面板账号密码是否正确
- 服务器是否能访问该面板端口
- 节点是否绑定了正确的面板
- 节点 `X-UI 入站 ID` 是否正确，或节点名称是否等于 X-UI 入站 remark
- X-UI client email 是否等于用户注册邮箱

## 测试教程

查看服务状态：

```bash
systemctl status xui-manager-panel --no-pager
```

测试网页是否能打开：

```bash
curl -I http://127.0.0.1:25888/
```

测试公开套餐接口：

```bash
curl http://127.0.0.1:25888/api/plans
```

测试订阅链接：

```bash
curl -i "http://服务器IP:25888/sub/clash/用户token"
```

返回头里应该能看到：

```text
Subscription-Userinfo: upload=0; download=...; total=...; expire=...
```

## 查看日志

实时日志：

```bash
journalctl -u xui-manager-panel -f
```

最近 200 行：

```bash
journalctl -u xui-manager-panel -n 200 --no-pager
```

重启服务：

```bash
systemctl restart xui-manager-panel
```

## 修改配置

运行端口、管理员种子账号、数据目录在：

```bash
nano /etc/xui-manager-panel/xui-manager.env
systemctl restart xui-manager-panel
```

数据库在：

```text
/opt/xui-manager-panel-data/app.db
```

备份数据库：

```bash
cp /opt/xui-manager-panel-data/app.db /root/xui-manager-panel-app.db.bak.$(date +%F-%H%M%S)
```

## 重置管理员账号

如果页面点击登录后提示 `Invalid email or password`，或者忘记安装时输出的随机密码，在服务器执行：

```bash
cd /opt/xui-manager-panel
git pull --ff-only
python3 tools/reset_admin.py --email 'admin@admin.com' --password 'admin@admin.com'
systemctl restart xui-manager-panel
```

然后用新的邮箱和密码登录。

## 更新项目

```bash
cd /opt/xui-manager-panel
git pull --ff-only
systemctl restart xui-manager-panel
```

## 卸载

保留数据卸载程序：

```bash
systemctl stop xui-manager-panel
systemctl disable xui-manager-panel
rm -f /etc/systemd/system/xui-manager-panel.service
systemctl daemon-reload
rm -rf /opt/xui-manager-panel
```

彻底删除数据和配置：

```bash
rm -rf /opt/xui-manager-panel-data /etc/xui-manager-panel
```

## 本地开发测试

```bash
python -m unittest discover tests -v
python -m xui_manager.app
```

默认监听 `0.0.0.0:25888`，可以通过环境变量调整：

```bash
set LISTEN_PORT=8765
set XUI_MANAGER_DATA=%cd%\data
set ADMIN_EMAIL=admin@example.com
set ADMIN_PASSWORD=ChangeMe123
python -m xui_manager.app
```
