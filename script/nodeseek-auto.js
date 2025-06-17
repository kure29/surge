/*
文件名：nodeseek-auto.js
NodeSeek 自动获取 Cookie 和签到模块

功能：
1. 自动拦截并保存访问 NodeSeek 时的 Cookie
2. 定时自动签到

配置方法：
1. 在 Surge 配置中添加以下内容：

[Script]
# 自动获取 Cookie（访问 NodeSeek 时触发）
nodeseek-cookie = type=http-request,pattern=^https?:\/\/(www\.)?nodeseek\.com,requires-body=0,max-size=0,script-path=nodeseek-auto.js

# 定时签到任务
nodeseek-checkin = type=cron,cron="0 9 * * *",script-path=nodeseek-auto.js

[MITM]
hostname = *.nodeseek.com

使用说明：
- 首次使用时，访问一次 NodeSeek 网站即可自动获取 Cookie
- 之后每天会自动签到
- 如需手动执行签到，可在 Surge 中运行脚本

作者：Assistant
*/

const $ = new Env('NodeSeek');

// 配置信息
const config = {
    // 域名匹配
    domain: 'nodeseek.com',
    // 签到相关URL（需要根据实际情况调整）
    checkinUrl: 'https://www.nodeseek.com/api/attendance',
    // Cookie 存储 key
    cookieKey: 'nodeseek_cookie',
    // 用户信息存储 key
    userInfoKey: 'nodeseek_userinfo'
};

// 主函数 - 根据运行环境执行不同逻辑
async function main() {
    // 判断运行环境
    if (typeof $request !== 'undefined') {
        // HTTP 请求环境 - 获取 Cookie
        await getCookie();
    } else {
        // Cron 定时任务环境 - 执行签到
        await performCheckin();
    }
}

// 获取并保存 Cookie
async function getCookie() {
    try {
        const url = $request.url;
        const headers = $request.headers;
        
        // 检查是否是 NodeSeek 域名
        if (!url.includes(config.domain)) {
            $.log('🔍 非目标域名，跳过');
            return;
        }
        
        // 获取 Cookie
        const cookie = headers['Cookie'] || headers['cookie'] || '';
        
        if (cookie) {
            // 保存 Cookie
            $.setdata(cookie, config.cookieKey);
            $.log('🍪 Cookie 已更新保存');
            
            // 提取用户信息（如果URL中包含用户信息）
            const userInfo = extractUserInfo(url, cookie);
            if (userInfo) {
                $.setdata(JSON.stringify(userInfo), config.userInfoKey);
                $.log(`👤 用户信息已保存: ${userInfo.username || 'Unknown'}`);
            }
            
            // 发送通知
            $.msg('NodeSeek Cookie', '获取成功', '已自动保存登录状态');
        } else {
            $.log('⚠️ 未检测到 Cookie');
        }
        
    } catch (error) {
        $.log(`❌ 获取 Cookie 失败: ${error}`);
    }
}

// 执行签到
async function performCheckin() {
    try {
        $.log('🚀 开始执行 NodeSeek 签到任务');
        
        // 获取保存的 Cookie
        const cookie = $.getdata(config.cookieKey);
        
        if (!cookie) {
            $.log('❌ 未找到保存的 Cookie');
            $.msg('NodeSeek 签到', '失败', '请先访问 NodeSeek 网站获取 Cookie');
            return;
        }
        
        $.log('🍪 使用已保存的 Cookie');
        
        // 执行签到
        const result = await checkin(cookie);
        
        if (result.success) {
            $.log('✅ 签到成功');
            $.msg('NodeSeek 签到', '成功', result.message || '今日签到完成');
        } else {
            $.log('❌ 签到失败');
            $.msg('NodeSeek 签到', '失败', result.message || '签到过程中出现错误');
            
            // 如果是 Cookie 过期，清除保存的 Cookie
            if (result.message && result.message.includes('登录')) {
                $.setdata('', config.cookieKey);
                $.log('🗑️ 已清除过期的 Cookie');
            }
        }
        
    } catch (error) {
        $.log(`❌ 签到任务执行出错: ${error}`);
        $.msg('NodeSeek 签到', '错误', error.toString());
    }
}

// 签到函数
async function checkin(cookie) {
    return new Promise((resolve) => {
        const options = {
            url: config.checkinUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'Cookie': cookie,
                'Referer': 'https://www.nodeseek.com/',
                'Origin': 'https://www.nodeseek.com',
                'X-Requested-With': 'XMLHttpRequest'
            },
            method: 'POST',
            body: JSON.stringify({}) // 根据实际需求调整
        };

        $.http.post(options).then(response => {
            const { status, body } = response;
            
            try {
                $.log(`📝 响应状态: ${status}`);
                $.log(`📝 响应内容: ${body}`);
                
                // 尝试解析 JSON 响应
                let data = {};
                try {
                    data = JSON.parse(body);
                } catch (e) {
                    // 如果不是 JSON，检查 HTML 响应
                    if (body.includes('签到成功') || body.includes('check-in successful')) {
                        resolve({ success: true, message: '签到成功' });
                        return;
                    } else if (body.includes('已签到') || body.includes('already checked')) {
                        resolve({ success: true, message: '今日已签到' });
                        return;
                    }
                }
                
                // 根据不同的响应格式判断结果
                if (status === 200) {
                    if (data.success === true || data.code === 0 || data.status === 'success') {
                        resolve({
                            success: true,
                            message: data.message || data.msg || '签到成功'
                        });
                    } else if (data.message && (data.message.includes('已签到') || data.message.includes('already'))) {
                        resolve({
                            success: true,
                            message: '今日已签到'
                        });
                    } else {
                        resolve({
                            success: false,
                            message: data.message || data.msg || data.error || '签到失败'
                        });
                    }
                } else if (status === 401 || status === 403) {
                    resolve({
                        success: false,
                        message: '登录状态已过期，请重新访问网站'
                    });
                } else {
                    resolve({
                        success: false,
                        message: `HTTP ${status}: 请求失败`
                    });
                }
                
            } catch (parseError) {
                $.log(`❌ 解析响应失败: ${parseError}`);
                resolve({
                    success: false,
                    message: '响应解析失败'
                });
            }
        }).catch(error => {
            $.log(`❌ 请求失败: ${error}`);
            resolve({
                success: false,
                message: `网络请求失败: ${error}`
            });
        });
    });
}

// 提取用户信息
function extractUserInfo(url, cookie) {
    try {
        let userInfo = {};
        
        // 从 Cookie 中提取用户信息
        const cookiePairs = cookie.split(';');
        for (const pair of cookiePairs) {
            const [key, value] = pair.trim().split('=');
            if (key && value) {
                if (key.toLowerCase().includes('user') || key.toLowerCase().includes('name')) {
                    userInfo[key] = decodeURIComponent(value);
                }
            }
        }
        
        // 从 URL 中提取信息（如果有的话）
        if (url.includes('/user/') || url.includes('/profile/')) {
            const matches = url.match(/\/(?:user|profile)\/([^\/\?]+)/);
            if (matches) {
                userInfo.username = matches[1];
            }
        }
        
        return Object.keys(userInfo).length > 0 ? userInfo : null;
    } catch (error) {
        $.log(`❌ 提取用户信息失败: ${error}`);
        return null;
    }
}

// Surge 环境适配函数
function Env(name) {
    return {
        name,
        log: console.log,
        msg: (title, subtitle, message) => {
            if (typeof $notification !== 'undefined') {
                $notification.post(title, subtitle, message);
            }
        },
        getdata: (key) => {
            if (typeof $persistentStore !== 'undefined') {
                return $persistentStore.read(key);
            }
            return null;
        },
        setdata: (value, key) => {
            if (typeof $persistentStore !== 'undefined') {
                return $persistentStore.write(value, key);
            }
            return false;
        },
        http: {
            post: (options) => {
                return new Promise((resolve, reject) => {
                    if (typeof $httpClient !== 'undefined') {
                        $httpClient.post(options, (error, response, data) => {
                            if (error) {
                                reject(error);
                            } else {
                                resolve({
                                    status: response.status,
                                    headers: response.headers,
                                    body: data
                                });
                            }
                        });
                    } else {
                        reject('HTTP client not available');
                    }
                });
            }
        },
        done: () => {
            if (typeof $done !== 'undefined') {
                $done();
            }
        }
    };
}

// 执行主函数
main().finally(() => $.done());
