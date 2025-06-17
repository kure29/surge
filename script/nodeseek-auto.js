/*
文件名：nodeseek-auto.js
NodeSeek 手动获取 Cookie 和自动签到模块

新逻辑：
1. 移除自动拦截获取 Cookie 的功能
2. 改为手动执行脚本获取 Cookie
3. 支持一键获取当前浏览器中的 Cookie
4. 定时自动签到功能保持不变

配置方法：
[Script]
# 手动获取 Cookie（在 Surge 中手动运行）
nodeseek-cookie = type=http-request,pattern=^https?:\/\/manual-cookie-get\.local,requires-body=0,max-size=0,script-path=nodeseek-auto.js,argument=action=getCookie

# 定时签到任务
nodeseek-checkin = type=cron,cronexp="0 9 * * *",script-path=nodeseek-auto.js,argument=action=checkin

# 手动签到（可选）
nodeseek-manual = type=http-request,pattern=^https?:\/\/manual-checkin\.local,requires-body=0,max-size=0,script-path=nodeseek-auto.js,argument=action=checkin

[MITM]
hostname = *.nodeseek.com

使用方法：
1. 登录 NodeSeek 网站后，在 Surge 中手动运行 "nodeseek-cookie" 脚本获取 Cookie
2. 或者访问 http://manual-cookie-get.local 触发获取
3. 之后每天自动签到，无需手动操作

作者：Assistant
*/

const $ = new Env('NodeSeek');

// 配置信息
const config = {
    domain: 'nodeseek.com',
    checkinUrl: 'https://www.nodeseek.com/api/attendance',
    cookieKey: 'nodeseek_cookie',
    userInfoKey: 'nodeseek_userinfo',
    lastUpdateKey: 'nodeseek_cookie_time'
};

// 主函数
async function main() {
    // 获取参数
    const action = getArgument('action');
    
    if (typeof $request !== 'undefined') {
        // HTTP 请求环境
        const url = $request.url;
        if (url.includes('manual-cookie-get.local')) {
            await manualGetCookie();
        } else if (url.includes('manual-checkin.local')) {
            await performCheckin();
        }
    } else {
        // Cron 环境或手动执行
        if (action === 'getCookie') {
            await manualGetCookie();
        } else {
            // 默认执行签到
            await performCheckin();
        }
    }
}

// 手动获取 Cookie（从当前 NodeSeek 页面）
async function manualGetCookie() {
    try {
        $.log('🔄 开始手动获取 NodeSeek Cookie');
        
        // 方法1：如果有 $request，从请求中获取
        if (typeof $request !== 'undefined' && $request.headers) {
            const cookie = $request.headers['Cookie'] || $request.headers['cookie'] || '';
            if (cookie && cookie.includes('nodeseek')) {
                await saveCookie(cookie);
                return;
            }
        }
        
        // 方法2：尝试从 NodeSeek 获取当前会话
        $.log('🌐 尝试从 NodeSeek 获取当前会话信息');
        await getCookieFromNodeSeek();
        
    } catch (error) {
        $.log(`❌ 手动获取 Cookie 失败: ${error}`);
        $.msg('NodeSeek Cookie', '获取失败', '请确保已登录 NodeSeek 网站');
    }
}

// 从 NodeSeek 网站获取 Cookie
async function getCookieFromNodeSeek() {
    try {
        // 访问 NodeSeek 主页获取 Cookie
        const response = await $.http.get({
            url: 'https://www.nodeseek.com/',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
            }
        });
        
        // 从响应头中获取 Set-Cookie
        const setCookies = response.headers['Set-Cookie'] || response.headers['set-cookie'] || [];
        let combinedCookie = '';
        
        if (Array.isArray(setCookies)) {
            combinedCookie = setCookies.map(cookie => cookie.split(';')[0]).join('; ');
        } else if (typeof setCookies === 'string') {
            combinedCookie = setCookies.split(';')[0];
        }
        
        if (combinedCookie) {
            await saveCookie(combinedCookie);
        } else {
            $.log('⚠️ 未能获取到有效的 Cookie，请手动登录后重试');
            $.msg('NodeSeek Cookie', '获取失败', '请先在浏览器中登录 NodeSeek，然后重试');
        }
        
    } catch (error) {
        $.log(`❌ 从 NodeSeek 获取 Cookie 失败: ${error}`);
        $.msg('NodeSeek Cookie', '获取失败', '网络请求失败，请检查网络连接');
    }
}

// 保存 Cookie
async function saveCookie(cookie) {
    try {
        if (!cookie) {
            $.log('❌ Cookie 为空');
            return false;
        }
        
        // 验证 Cookie 是否有效
        $.log('🔍 验证 Cookie 有效性...');
        const isValid = await validateCookie(cookie);
        
        if (!isValid) {
            $.log('❌ Cookie 无效或已过期');
            $.msg('NodeSeek Cookie', '获取失败', 'Cookie 无效，请重新登录');
            return false;
        }
        
        // 保存 Cookie 和时间戳
        $.setdata(cookie, config.cookieKey);
        $.setdata(Date.now().toString(), config.lastUpdateKey);
        
        $.log('✅ Cookie 已成功保存');
        
        // 获取用户信息
        const userInfo = await getUserInfo(cookie);
        if (userInfo) {
            $.setdata(JSON.stringify(userInfo), config.userInfoKey);
            $.log(`👤 用户信息已保存: ${userInfo.username || 'Unknown'}`);
            $.msg('NodeSeek Cookie', '获取成功', `用户: ${userInfo.username || 'Unknown'}`);
        } else {
            $.msg('NodeSeek Cookie', '获取成功', '已保存登录状态');
        }
        
        return true;
        
    } catch (error) {
        $.log(`❌ 保存 Cookie 失败: ${error}`);
        $.msg('NodeSeek Cookie', '保存失败', error.toString());
        return false;
    }
}

// 验证 Cookie 有效性
async function validateCookie(cookie) {
    try {
        const response = await $.http.get({
            url: 'https://www.nodeseek.com/api/user/info',
            headers: {
                'Cookie': cookie,
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://www.nodeseek.com/'
            }
        });
        
        $.log(`🔍 Cookie 验证响应状态: ${response.status}`);
        return response.status === 200;
        
    } catch (error) {
        $.log(`⚠️ Cookie 验证失败: ${error}`);
        return false;
    }
}

// 获取用户信息
async function getUserInfo(cookie) {
    try {
        const response = await $.http.get({
            url: 'https://www.nodeseek.com/api/user/info',
            headers: {
                'Cookie': cookie,
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
                'Accept': 'application/json',
                'Referer': 'https://www.nodeseek.com/'
            }
        });
        
        if (response.status === 200) {
            try {
                const data = JSON.parse(response.body);
                return {
                    username: data.username || data.name || data.user?.name,
                    id: data.id || data.user?.id,
                    email: data.email || data.user?.email
                };
            } catch (e) {
                $.log('⚠️ 解析用户信息失败');
            }
        }
        
        return null;
    } catch (error) {
        $.log(`⚠️ 获取用户信息失败: ${error}`);
        return null;
    }
}

// 执行签到
async function performCheckin() {
    try {
        $.log('🚀 开始执行 NodeSeek 签到任务');
        
        const cookie = $.getdata(config.cookieKey);
        if (!cookie) {
            $.log('❌ 未找到保存的 Cookie');
            $.msg('NodeSeek 签到', '失败', '请先手动获取 Cookie');
            return;
        }
        
        // 验证 Cookie 是否仍然有效
        const isValid = await validateCookie(cookie);
        if (!isValid) {
            $.log('❌ Cookie 已过期');
            $.msg('NodeSeek 签到', '失败', 'Cookie 已过期，请重新获取');
            // 清除过期 Cookie
            $.setdata('', config.cookieKey);
            $.setdata('', config.lastUpdateKey);
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
            
            // 如果是认证问题，清除 Cookie
            if (result.needReauth) {
                $.setdata('', config.cookieKey);
                $.setdata('', config.lastUpdateKey);
                $.log('🗑️ 已清除无效的 Cookie');
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
            body: JSON.stringify({})
        };

        $.http.post(options).then(response => {
            const { status, body } = response;
            
            try {
                $.log(`📝 签到响应状态: ${status}`);
                $.log(`📝 签到响应内容: ${body}`);
                
                let data = {};
                try {
                    data = JSON.parse(body);
                } catch (e) {
                    // HTML 响应处理
                    if (body.includes('签到成功') || body.includes('check-in successful')) {
                        resolve({ success: true, message: '签到成功' });
                        return;
                    } else if (body.includes('已签到') || body.includes('already checked')) {
                        resolve({ success: true, message: '今日已签到' });
                        return;
                    }
                }
                
                // JSON 响应处理
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
                        message: '登录状态已过期，请重新获取 Cookie',
                        needReauth: true
                    });
                } else {
                    resolve({
                        success: false,
                        message: `HTTP ${status}: 请求失败`
                    });
                }
                
            } catch (parseError) {
                $.log(`❌ 解析签到响应失败: ${parseError}`);
                resolve({
                    success: false,
                    message: '响应解析失败'
                });
            }
        }).catch(error => {
            $.log(`❌ 签到请求失败: ${error}`);
            resolve({
                success: false,
                message: `网络请求失败: ${error}`
            });
        });
    });
}

// 获取脚本参数
function getArgument(key) {
    if (typeof $argument !== 'undefined' && $argument) {
        const pairs = $argument.split('&');
        for (const pair of pairs) {
            const [k, v] = pair.split('=');
            if (k === key) {
                return v;
            }
        }
    }
    return null;
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
            get: (options) => {
                return new Promise((resolve, reject) => {
                    if (typeof $httpClient !== 'undefined') {
                        $httpClient.get(options, (error, response, data) => {
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
            },
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
