/*
文件名：nodeseek-auto.js
NodeSeek 智能获取 Cookie 和自动签到模块

智能逻辑：
1. 支持 Surge 模块参数配置
2. 只在 Cookie 失效时才自动获取
3. 优先使用配置的 Cookie，失效后才拦截获取
4. 避免频繁拦截和获取

配置参数：
- cookie: 手动配置的 Cookie（可选）
- auto_refresh: 是否自动刷新 Cookie（默认开启）
- cron: 签到时间设置

作者：Assistant
*/

const $ = new Env('NodeSeek');

// 配置信息
const config = {
    domain: 'nodeseek.com',
    checkinUrl: 'https://www.nodeseek.com/api/attendance',
    cookieKey: 'nodeseek_cookie_stored',
    userInfoKey: 'nodeseek_userinfo',
    lastUpdateKey: 'nodeseek_cookie_time',
    lastCheckKey: 'nodeseek_last_check',
    // Cookie 检查间隔（小时）- 避免频繁检查
    checkInterval: 4
};

// 主函数
async function main() {
    // 获取模块参数
    const args = parseArguments();
    
    if (typeof $request !== 'undefined') {
        // HTTP 请求环境 - 智能获取 Cookie
        await smartCookieHandler(args);
    } else {
        // Cron 定时任务环境 - 执行签到
        await performCheckin(args);
    }
}

// 解析模块参数
function parseArguments() {
    const args = {
        cookie: '',
        auto_refresh: true,
        silent_mode: true,
        cron: '0 9 * * *'
    };
    
    if (typeof $argument !== 'undefined' && $argument) {
        const pairs = $argument.split('&');
        for (const pair of pairs) {
            const [key, value] = pair.split('=');
            if (key && value) {
                const decodedValue = decodeURIComponent(value);
                switch (key) {
                    case 'cookie':
                        args.cookie = decodedValue === '{{{cookie}}}' ? '' : decodedValue;
                        break;
                    case 'auto_refresh':
                        args.auto_refresh = decodedValue === 'true' || decodedValue === '{{{auto_refresh}}}';
                        break;
                    case 'silent_mode':
                        args.silent_mode = decodedValue === 'true' || decodedValue === '{{{silent_mode}}}';
                        break;
                    case 'cron':
                        args.cron = decodedValue === '{{{cron}}}' ? '0 9 * * *' : decodedValue;
                        break;
                }
            }
        }
    }
    
    $.log(`📋 解析参数 - Cookie: ${args.cookie ? '已配置' : '未配置'}, 自动刷新: ${args.auto_refresh}, 静默模式: ${args.silent_mode}`);
    return args;
}

// 智能 Cookie 处理
async function smartCookieHandler(args) {
    try {
        const url = $request.url;
        const headers = $request.headers;
        
        $.log(`🌐 当前访问: ${url}`);
        
        // 检查是否为 NodeSeek 域名
        if (!url.includes(config.domain)) {
            $.log('❌ 非 NodeSeek 域名，跳过处理');
            return;
        }
        
        // 检查是否需要获取 Cookie
        $.log('🔍 开始检查是否需要获取 Cookie...');
        const needsCookie = await shouldGetCookie(args);
        if (!needsCookie) {
            $.log('✅ Cookie 仍然有效，跳过获取');
            return;
        }
        
        // 获取当前请求的 Cookie
        const currentCookie = headers['Cookie'] || headers['cookie'] || '';
        if (!currentCookie) {
            $.log('⚠️ 当前请求中未检测到 Cookie');
            return;
        }
        
        $.log('🍪 检测到新的 Cookie，开始验证和保存...');
        const success = await saveCookie(currentCookie, args.silent_mode);
        
        // 根据静默模式决定是否发送通知
        if (success && !args.silent_mode) {
            const userInfo = JSON.parse($.getdata(config.userInfoKey) || '{}');
            $.msg('NodeSeek Cookie', '获取成功', `用户: ${userInfo.username || 'Unknown'}`);
        }
        
    } catch (error) {
        $.log(`❌ 智能 Cookie 处理失败: ${error}`);
    }
}

// 判断是否需要获取 Cookie
async function shouldGetCookie(args) {
    try {
        $.log('🔍 开始评估 Cookie 状态...');
        
        // 1. 检查频率限制 - 避免过于频繁的检查
        const lastCheck = $.getdata(config.lastCheckKey) || '0';
        const lastCheckTime = parseInt(lastCheck);
        const now = Date.now();
        const minutesSinceCheck = (now - lastCheckTime) / (1000 * 60);
        
        $.log(`⏱️ 距离上次检查: ${Math.round(minutesSinceCheck)} 分钟`);
        
        // 如果距离上次检查不到30分钟，且不是首次检查，跳过
        if (minutesSinceCheck < 30 && lastCheckTime > 0) {
            $.log(`⏱️ 距离上次检查仅 ${Math.round(minutesSinceCheck)} 分钟，跳过检查`);
            return false;
        }
        
        // 更新检查时间
        $.setdata(now.toString(), config.lastCheckKey);
        $.log('📝 已更新检查时间戳');
        
        // 2. 获取当前有效的 Cookie
        let currentCookie = '';
        let cookieSource = '';
        
        // 优先使用模块配置的 Cookie
        if (args.cookie && args.cookie.trim()) {
            currentCookie = args.cookie.trim();
            cookieSource = '模块配置';
            $.log('🔧 使用模块配置的 Cookie');
        } else {
            // 使用存储的 Cookie
            currentCookie = $.getdata(config.cookieKey) || '';
            cookieSource = '本地存储';
            $.log('💾 使用存储的 Cookie');
        }
        
        // 3. 如果没有 Cookie，需要获取
        if (!currentCookie) {
            $.log('🆕 未找到有效 Cookie，需要获取');
            return true;
        }
        
        $.log(`🍪 当前 Cookie 来源: ${cookieSource}`);
        
        // 4. 验证 Cookie 是否仍然有效
        $.log('🔍 验证当前 Cookie 有效性...');
        const isValid = await validateCookie(currentCookie);
        
        if (!isValid) {
            $.log('❌ 当前 Cookie 已失效');
            if (args.auto_refresh) {
                $.log('🔄 自动刷新已启用，需要重新获取');
                return true;
            } else {
                $.log('🔒 自动刷新已禁用，跳过获取');
                return false;
            }
        }
        
        $.log('✅ Cookie 验证通过，状态良好');
        return false;
        
    } catch (error) {
        $.log(`❌ 检查 Cookie 状态失败: ${error}`);
        return args.auto_refresh;
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
            },
            timeout: 10
        });
        
        const isValid = response.status === 200;
        $.log(`🔍 Cookie 验证结果: ${isValid ? '✅ 有效' : '❌ 无效'} (状态码: ${response.status})`);
        return isValid;
        
    } catch (error) {
        $.log(`⚠️ Cookie 验证失败: ${error}`);
        return false;
    }
}

// 保存 Cookie
async function saveCookie(cookie, silentMode = true) {
    try {
        if (!cookie || !cookie.includes('nodeseek')) {
            $.log('⚠️ Cookie 格式不正确');
            return false;
        }
        
        // 验证新 Cookie 的有效性
        $.log('🔍 验证新 Cookie 有效性...');
        const isValid = await validateCookie(cookie);
        
        if (!isValid) {
            $.log('❌ 新 Cookie 无效');
            // 根据静默模式决定是否发送通知
            if (!silentMode) {
                $.msg('NodeSeek Cookie', '获取失败', 'Cookie 无效，请确认已正确登录');
            }
            return false;
        }
        
        // 保存 Cookie 和时间戳
        $.setdata(cookie, config.cookieKey);
        $.setdata(Date.now().toString(), config.lastUpdateKey);
        $.setdata(Date.now().toString(), config.lastCheckKey);
        
        $.log('✅ Cookie 已成功保存');
        
        // 获取并保存用户信息
        const userInfo = await getUserInfo(cookie);
        if (userInfo) {
            $.setdata(JSON.stringify(userInfo), config.userInfoKey);
            $.log(`👤 用户信息已保存: ${userInfo.username || 'Unknown'}`);
        }
        
        // 根据静默模式决定是否发送通知
        if (!silentMode) {
            if (userInfo) {
                $.msg('NodeSeek Cookie', '更新成功', `用户: ${userInfo.username || 'Unknown'}`);
            } else {
                $.msg('NodeSeek Cookie', '更新成功', '已保存最新登录状态');
            }
        } else {
            $.log('🔕 Cookie 已静默更新，无需通知');
        }
        
        return true;
        
    } catch (error) {
        $.log(`❌ 保存 Cookie 失败: ${error}`);
        // 根据静默模式决定是否发送通知
        if (!silentMode) {
            $.msg('NodeSeek Cookie', '保存失败', error.toString());
        }
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
            },
            timeout: 10
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
async function performCheckin(args) {
    try {
        $.log('🚀 开始执行 NodeSeek 签到任务');
        
        // 获取 Cookie
        let cookie = '';
        
        // 优先使用模块配置的 Cookie
        if (args.cookie && args.cookie.trim()) {
            cookie = args.cookie.trim();
            $.log('🔧 使用模块配置的 Cookie');
        } else {
            // 使用存储的 Cookie
            cookie = $.getdata(config.cookieKey) || '';
            $.log('💾 使用存储的 Cookie');
        }
        
        if (!cookie) {
            $.log('❌ 未找到可用的 Cookie');
            $.msg('NodeSeek 签到', '失败', '请先配置 Cookie 或访问 NodeSeek 网站获取');
            return;
        }
        
        // 验证 Cookie 是否仍然有效
        const isValid = await validateCookie(cookie);
        if (!isValid) {
            $.log('❌ Cookie 已过期');
            
            if (args.auto_refresh) {
                $.msg('NodeSeek 签到', '失败', 'Cookie 已过期，请重新访问网站刷新');
                // 清除存储的过期 Cookie
                $.setdata('', config.cookieKey);
                $.setdata('', config.lastUpdateKey);
            } else {
                $.msg('NodeSeek 签到', '失败', 'Cookie 已过期，请在模块中更新 Cookie');
            }
            return;
        }
        
        $.log('🍪 Cookie 验证通过，开始签到');
        
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
            body: JSON.stringify({}),
            timeout: 15
        };

        $.http.post(options).then(response => {
            const { status, body } = response;
            
            try {
                $.log(`📝 签到响应状态: ${status}`);
                
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
                        message: '登录状态已过期',
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
