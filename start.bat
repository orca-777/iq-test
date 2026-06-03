@echo off
chcp 65001 >nul
title 管培生综合评估系统
color 0A

echo ============================================================
echo   管培生综合评估系统 - 一键启动
echo ============================================================
echo.

cd /d %~dp0

rem 检查数据库
if not exist "server\data\assessment.db" (
    echo [初始化] 数据库不存在，正在初始化...
    "C:\Users\ZT27381\.workbuddy\binaries\node\versions\22.12.0\node.exe" server\init-db.js
    echo.
)

rem 获取本机局域网 IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    set RAW_IP=%%a
    goto :got_ip
)
:got_ip
set LAN_IP=%RAW_IP: =%

echo ============================================================
echo   本地访问地址（推荐）:
echo     考生入口:  http://localhost:3000
echo     管理后台:  http://localhost:3000/admin
echo.
echo   局域网访问地址（同一WiFi下其他设备）:
echo     考生入口:  http://%LAN_IP%:3000
echo     管理后台:  http://%LAN_IP%:3000/admin
echo.
echo   GitHub Pages 考生入口（需配置后端地址）:
echo     https://serena-11a.github.io/iq-test/
echo     配置后端: https://serena-11a.github.io/iq-test/?api=http://%LAN_IP%:3000
echo.
echo   管理员账号:
echo     超级管理员: admin / admin123
echo     考务管理员: examadmin / exam123
echo     只读用户:   viewer / read123
echo ============================================================
echo.
echo [启动] 正在启动服务器...按 Ctrl+C 停止服务
echo.

"C:\Users\ZT27381\.workbuddy\binaries\node\versions\22.12.0\node.exe" server\server.js
pause
