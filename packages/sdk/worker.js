"use strict";
(() => {
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

  // ../pkg-web/vm_core.js
  var import_meta = {};
  var native_call = (arg0, arg1) => typeof self !== "undefined" && typeof self.native_call === "function" ? self.native_call(arg0, arg1) : typeof window !== "undefined" && typeof window.native_call === "function" ? window.native_call(arg0, arg1) : "";
  function execute(bytecode, handshake_header, input_json, opcode_map) {
    let deferred5_0;
    let deferred5_1;
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(bytecode, wasm.__wbindgen_export2);
      const len0 = WASM_VECTOR_LEN;
      const ptr1 = passArray8ToWasm0(handshake_header, wasm.__wbindgen_export2);
      const len1 = WASM_VECTOR_LEN;
      const ptr2 = passStringToWasm0(input_json, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const len2 = WASM_VECTOR_LEN;
      const ptr3 = passArray8ToWasm0(opcode_map, wasm.__wbindgen_export2);
      const len3 = WASM_VECTOR_LEN;
      wasm.execute(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      deferred5_0 = r0;
      deferred5_1 = r1;
      return getStringFromWasm0(r0, r1);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
      wasm.__wbindgen_export4(deferred5_0, deferred5_1, 1);
    }
  }
  function generate_client_keypair() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.generate_client_keypair(retptr);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
      if (r3) {
        throw takeObject(r2);
      }
      var v1 = getArrayU8FromWasm0(r0, r1).slice();
      wasm.__wbindgen_export4(r0, r1 * 1, 1);
      return v1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  function init_crypto(image_bytes, _width, _height, session_seed, fingerprint, epoch_day) {
    const ptr0 = passArray8ToWasm0(image_bytes, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(session_seed, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(fingerprint, wasm.__wbindgen_export2);
    const len2 = WASM_VECTOR_LEN;
    wasm.init_crypto(ptr0, len0, _width, _height, ptr1, len1, ptr2, len2, epoch_day);
  }
  function init_crypto_with_key(stego_key_bytes, session_seed, fingerprint, epoch_day) {
    const ptr0 = passArray8ToWasm0(stego_key_bytes, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(session_seed, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(fingerprint, wasm.__wbindgen_export2);
    const len2 = WASM_VECTOR_LEN;
    wasm.init_crypto_with_key(ptr0, len0, ptr1, len1, ptr2, len2, epoch_day);
  }
  function set_client_private_key(key) {
    const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.set_client_private_key(ptr0, len0);
    return ret !== 0;
  }
  function sign_request(method, url, body_str, timestamp) {
    let deferred5_0;
    let deferred5_1;
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passStringToWasm0(method, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const len0 = WASM_VECTOR_LEN;
      const ptr1 = passStringToWasm0(url, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const len1 = WASM_VECTOR_LEN;
      const ptr2 = passStringToWasm0(body_str, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const len2 = WASM_VECTOR_LEN;
      const ptr3 = passStringToWasm0(timestamp, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
      const len3 = WASM_VECTOR_LEN;
      wasm.sign_request(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      deferred5_0 = r0;
      deferred5_1 = r1;
      return getStringFromWasm0(r0, r1);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
      wasm.__wbindgen_export4(deferred5_0, deferred5_1, 1);
    }
  }
  function __wbg_get_imports() {
    const import0 = {
      __proto__: null,
      __wbg___wbindgen_is_function_5cd60d5cf78b4eef: function(arg0) {
        const ret = typeof getObject(arg0) === "function";
        return ret;
      },
      __wbg___wbindgen_is_object_b4593df85baada48: function(arg0) {
        const val = getObject(arg0);
        const ret = typeof val === "object" && val !== null;
        return ret;
      },
      __wbg___wbindgen_is_string_dde0fd9020db4434: function(arg0) {
        const ret = typeof getObject(arg0) === "string";
        return ret;
      },
      __wbg___wbindgen_is_undefined_35bb9f4c7fd651d5: function(arg0) {
        const ret = getObject(arg0) === void 0;
        return ret;
      },
      __wbg___wbindgen_throw_9c31b086c2b26051: function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
      },
      __wbg_call_dfde26266607c996: function() {
        return handleError(function(arg0, arg1, arg2) {
          const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
          return addHeapObject(ret);
        }, arguments);
      },
      __wbg_crypto_38df2bab126b63dc: function(arg0) {
        const ret = getObject(arg0).crypto;
        return addHeapObject(ret);
      },
      __wbg_getRandomValues_c44a50d8cfdaebeb: function() {
        return handleError(function(arg0, arg1) {
          getObject(arg0).getRandomValues(getObject(arg1));
        }, arguments);
      },
      __wbg_instanceof_Window_faa5cf994f49cca7: function(arg0) {
        let result;
        try {
          result = getObject(arg0) instanceof Window;
        } catch (_) {
          result = false;
        }
        const ret = result;
        return ret;
      },
      __wbg_instanceof_WorkerGlobalScope_a93ee1765e6a23bf: function(arg0) {
        let result;
        try {
          result = getObject(arg0) instanceof WorkerGlobalScope;
        } catch (_) {
          result = false;
        }
        const ret = result;
        return ret;
      },
      __wbg_length_56fcd3e2b7e0299d: function(arg0) {
        const ret = getObject(arg0).length;
        return ret;
      },
      __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
        const ret = getObject(arg0).msCrypto;
        return addHeapObject(ret);
      },
      __wbg_native_call_f2da9fab576796a8: function(arg0, arg1, arg2, arg3) {
        const ret = native_call(arg1 >>> 0, getStringFromWasm0(arg2, arg3));
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export2, wasm.__wbindgen_export3);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
      },
      __wbg_new_with_length_99887c91eae4abab: function(arg0) {
        const ret = new Uint8Array(arg0 >>> 0);
        return addHeapObject(ret);
      },
      __wbg_node_84ea875411254db1: function(arg0) {
        const ret = getObject(arg0).node;
        return addHeapObject(ret);
      },
      __wbg_now_3cd905700d21a70b: function(arg0) {
        const ret = getObject(arg0).now();
        return ret;
      },
      __wbg_now_81363d44c96dd239: function() {
        const ret = Date.now();
        return ret;
      },
      __wbg_performance_a22a4e2bf3e69855: function(arg0) {
        const ret = getObject(arg0).performance;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
      },
      __wbg_performance_ddd4e7eeef6254f3: function(arg0) {
        const ret = getObject(arg0).performance;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
      },
      __wbg_process_44c7a14e11e9f69e: function(arg0) {
        const ret = getObject(arg0).process;
        return addHeapObject(ret);
      },
      __wbg_prototypesetcall_5f9bdc8d75e07276: function(arg0, arg1, arg2) {
        Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), getObject(arg2));
      },
      __wbg_randomFillSync_6c25eac9869eb53c: function() {
        return handleError(function(arg0, arg1) {
          getObject(arg0).randomFillSync(takeObject(arg1));
        }, arguments);
      },
      __wbg_require_b4edbdcf3e2a1ef0: function() {
        return handleError(function() {
          const ret = module.require;
          return addHeapObject(ret);
        }, arguments);
      },
      __wbg_static_accessor_GLOBAL_THIS_02344c9b09eb08a9: function() {
        const ret = typeof globalThis === "undefined" ? null : globalThis;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
      },
      __wbg_static_accessor_GLOBAL_ac6d4ac874d5cd54: function() {
        const ret = typeof global === "undefined" ? null : global;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
      },
      __wbg_static_accessor_SELF_9b2406c23aeb2023: function() {
        const ret = typeof self === "undefined" ? null : self;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
      },
      __wbg_static_accessor_WINDOW_b34d2126934e16ba: function() {
        const ret = typeof window === "undefined" ? null : window;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
      },
      __wbg_subarray_7c6a0da8f3b4a1ba: function(arg0, arg1, arg2) {
        const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
        return addHeapObject(ret);
      },
      __wbg_versions_276b2795b1c6a219: function(arg0) {
        const ret = getObject(arg0).versions;
        return addHeapObject(ret);
      },
      __wbindgen_cast_0000000000000001: function(arg0, arg1) {
        const ret = getArrayU8FromWasm0(arg0, arg1);
        return addHeapObject(ret);
      },
      __wbindgen_cast_0000000000000002: function(arg0, arg1) {
        const ret = getStringFromWasm0(arg0, arg1);
        return addHeapObject(ret);
      },
      __wbindgen_object_clone_ref: function(arg0) {
        const ret = getObject(arg0);
        return addHeapObject(ret);
      },
      __wbindgen_object_drop_ref: function(arg0) {
        takeObject(arg0);
      }
    };
    return {
      __proto__: null,
      "./vm_core_bg.js": import0
    };
  }
  function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];
    heap[idx] = obj;
    return idx;
  }
  function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
  }
  function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
  }
  var cachedDataViewMemory0 = null;
  function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
      cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
  }
  function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
  }
  var cachedUint8ArrayMemory0 = null;
  function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
      cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
  }
  function getObject(idx) {
    return heap[idx];
  }
  function handleError(f, args) {
    try {
      return f.apply(this, args);
    } catch (e) {
      wasm.__wbindgen_export(addHeapObject(e));
    }
  }
  var heap = new Array(1024).fill(void 0);
  heap.push(void 0, null, true, false);
  var heap_next = heap.length;
  function isLikeNone(x) {
    return x === void 0 || x === null;
  }
  function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
  }
  function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === void 0) {
      const buf = cachedTextEncoder.encode(arg);
      const ptr2 = malloc(buf.length, 1) >>> 0;
      getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);
      WASM_VECTOR_LEN = buf.length;
      return ptr2;
    }
    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;
    const mem = getUint8ArrayMemory0();
    let offset = 0;
    for (; offset < len; offset++) {
      const code = arg.charCodeAt(offset);
      if (code > 127) break;
      mem[ptr + offset] = code;
    }
    if (offset !== len) {
      if (offset !== 0) {
        arg = arg.slice(offset);
      }
      ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
      const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
      const ret = cachedTextEncoder.encodeInto(arg, view);
      offset += ret.written;
      ptr = realloc(ptr, len, offset, 1) >>> 0;
    }
    WASM_VECTOR_LEN = offset;
    return ptr;
  }
  function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
  }
  var cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
  cachedTextDecoder.decode();
  var MAX_SAFARI_DECODE_BYTES = 2146435072;
  var numBytesDecoded = 0;
  function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
      cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
      cachedTextDecoder.decode();
      numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
  }
  var cachedTextEncoder = new TextEncoder();
  if (!("encodeInto" in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function(arg, view) {
      const buf = cachedTextEncoder.encode(arg);
      view.set(buf);
      return {
        read: arg.length,
        written: buf.length
      };
    };
  }
  var WASM_VECTOR_LEN = 0;
  var wasmModule;
  var wasmInstance;
  var wasm;
  function __wbg_finalize_init(instance, module2) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module2;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
  }
  async function __wbg_load(module2, imports) {
    if (typeof Response === "function" && module2 instanceof Response) {
      if (typeof WebAssembly.instantiateStreaming === "function") {
        try {
          return await WebAssembly.instantiateStreaming(module2, imports);
        } catch (e) {
          const validResponse = module2.ok && expectedResponseType(module2.type);
          if (validResponse && module2.headers.get("Content-Type") !== "application/wasm") {
            console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
          } else {
            throw e;
          }
        }
      }
      const bytes = await module2.arrayBuffer();
      return await WebAssembly.instantiate(bytes, imports);
    } else {
      const instance = await WebAssembly.instantiate(module2, imports);
      if (instance instanceof WebAssembly.Instance) {
        return { instance, module: module2 };
      } else {
        return instance;
      }
    }
    function expectedResponseType(type) {
      switch (type) {
        case "basic":
        case "cors":
        case "default":
          return true;
      }
      return false;
    }
  }
  async function __wbg_init(module_or_path) {
    if (wasm !== void 0) return wasm;
    if (module_or_path !== void 0) {
      if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
        ({ module_or_path } = module_or_path);
      } else {
        console.warn("using deprecated parameters for the initialization function; pass a single object instead");
      }
    }
    if (module_or_path === void 0) {
      module_or_path = new URL("vm_core_bg.wasm", import_meta.url);
    }
    const imports = __wbg_get_imports();
    if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {
      module_or_path = fetch(module_or_path);
    }
    const { instance, module: module2 } = await __wbg_load(await module_or_path, imports);
    return __wbg_finalize_init(instance, module2);
  }

  // src/router.ts
  function nativeCallRouter(id, argsJson, cachedNativeData, workerInitTime) {
    try {
      if (argsJson && argsJson.length > 4096) {
        return JSON.stringify({ error: "PayloadTooLarge" });
      }
      switch (id) {
        case 1: {
          return cachedNativeData && cachedNativeData.webgl || "";
        }
        case 2: {
          return cachedNativeData && cachedNativeData.canvas || "";
        }
        case 3: {
          return JSON.stringify(cachedNativeData && cachedNativeData.automation || {});
        }
        case 4: {
          const screenData = { ...cachedNativeData && cachedNativeData.screen || {} };
          if (argsJson) {
            const args = JSON.parse(argsJson);
            if (Array.isArray(args) && args.length >= 2) {
              if (typeof args[0] === "number") {
                screenData.width = args[0];
                screenData.availWidth = args[0];
                if (cachedNativeData && cachedNativeData.screen) {
                  cachedNativeData.screen.width = args[0];
                  cachedNativeData.screen.availWidth = args[0];
                }
              }
              if (typeof args[1] === "number") {
                screenData.height = args[1];
                screenData.availHeight = args[1];
                if (cachedNativeData && cachedNativeData.screen) {
                  cachedNativeData.screen.height = args[1];
                  cachedNativeData.screen.availHeight = args[1];
                }
              }
            }
          }
          return JSON.stringify(screenData);
        }
        case 1001: {
          const hasNavigator = typeof navigator !== "undefined";
          const webdriver = hasNavigator && typeof navigator.webdriver !== "undefined" ? navigator.webdriver : false;
          const hardwareConcurrency = hasNavigator && typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : 4;
          const deviceMemory = hasNavigator && typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : 8;
          const languages = hasNavigator && Array.isArray(navigator.languages) ? navigator.languages : ["en-US", "en"];
          const plugins_count = hasNavigator && navigator.plugins && typeof navigator.plugins.length === "number" ? navigator.plugins.length : 0;
          return JSON.stringify({
            webdriver,
            hardwareConcurrency,
            deviceMemory,
            languages,
            plugins_count
          });
        }
        case 1002: {
          const delta_ms = performance.now() - workerInitTime;
          return JSON.stringify({ delta_ms });
        }
        case 1003: {
          if (typeof OffscreenCanvas === "undefined") {
            return JSON.stringify({ supported: false });
          }
          try {
            const canvas = new OffscreenCanvas(256, 256);
            const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
            if (!gl) {
              return JSON.stringify({ supported: false });
            }
            const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
            const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
            const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
            const version = gl.getParameter(gl.VERSION);
            const shadingLanguageVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
            return JSON.stringify({
              supported: true,
              vendor: String(vendor),
              renderer: String(renderer),
              version: String(version),
              shadingLanguageVersion: String(shadingLanguageVersion)
            });
          } catch (err) {
            return JSON.stringify({ supported: false });
          }
        }
        case 1004: {
          const scr = typeof screen !== "undefined" ? screen : {};
          const width = typeof scr.width === "number" ? scr.width : 1920;
          const height = typeof scr.height === "number" ? scr.height : 1080;
          const colorDepth = typeof scr.colorDepth === "number" ? scr.colorDepth : 24;
          const pixelRatio = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
          return JSON.stringify({
            width,
            height,
            colorDepth,
            pixelRatio
          });
        }
        case 9999: {
          return JSON.stringify({
            status: "ok",
            timestamp: Date.now()
          });
        }
        default:
          return "";
      }
    } catch (err) {
      return JSON.stringify({
        error: "HandlerError",
        message: err.message || String(err)
      });
    }
  }

  // src/worker.ts
  var isNode = typeof process !== "undefined" && process.versions && process.versions.node;
  if (isNode) {
    const Module = __require("module");
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function(id) {
      if (id === "env") {
        return {
          native_call: function() {
            return "{}";
          }
        };
      }
      return originalRequire.apply(this, arguments);
    };
    let vmNode = null;
    try {
      if (typeof __dirname !== "undefined") {
        const path = __require("path");
        const fs = __require("fs");
        const possiblePaths = [
          path.join(__dirname, "../../pkg-node/vm_core.js"),
          path.join(__dirname, "../pkg-node/vm_core.js"),
          path.join(__dirname, "./pkg-node/vm_core.js"),
          path.join(process.cwd(), "pkg-node/vm_core.js")
        ];
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            vmNode = __require(p);
            break;
          }
        }
      }
    } catch (e) {
    }
    if (!vmNode) {
      try {
        vmNode = __require("./pkg-node/vm_core.js");
      } catch (e) {
        try {
          vmNode = __require("../../pkg-node/vm_core.js");
        } catch (err) {
          try {
            vmNode = __require("../pkg-node/vm_core.js");
          } catch (err2) {
            const path = __require("path");
            vmNode = __require(path.join(process.cwd(), "pkg-node/vm_core.js"));
          }
        }
      }
    }
    const { parentPort } = __require("worker_threads");
    let isReadyNode = false;
    let storedBytecode = null;
    let storedHandshakeHeader = null;
    let storedOpcodeMap = null;
    parentPort.on("message", async (data) => {
      const { id, type, payload } = data;
      if (type === "INIT") {
        storedBytecode = payload.bytecode;
        storedHandshakeHeader = payload.handshakeHeader;
        storedOpcodeMap = payload.opcodeMap;
        const handshakeArr = storedHandshakeHeader ? new Uint8Array(storedHandshakeHeader) : null;
        if (handshakeArr && handshakeArr.length === 154 && handshakeArr.every((b) => b === 0)) {
          vmNode.init_crypto_with_key(new Uint8Array(32), new Uint8Array(32), new Uint8Array(32), 0);
        } else if (payload.clientPrivateKey) {
          vmNode.set_client_private_key(new Uint8Array(payload.clientPrivateKey));
        }
        isReadyNode = true;
        parentPort.postMessage({ id, type: "INIT_SUCCESS" });
      } else if (type === "EXECUTE") {
        if (!isReadyNode) {
          parentPort.postMessage({ id, type: "ERROR", error: "VM not initialized" });
          return;
        }
        try {
          const { input } = payload;
          if (process.env.DEV_MODE === "true" && storedBytecode) {
            const crypto = __require("crypto");
            const hashBytes = crypto.createHash("sha256").update(new Uint8Array(storedBytecode)).digest();
            vmNode.set_payload_hash(new Uint8Array(hashBytes));
          }
          const result = vmNode.execute(
            new Uint8Array(storedBytecode),
            new Uint8Array(storedHandshakeHeader),
            JSON.stringify(Array.isArray(input) ? input : [input]),
            new Uint8Array(storedOpcodeMap)
          );
          parentPort.postMessage({ id, type: "EXECUTE_SUCCESS", result });
        } catch (err) {
          parentPort.postMessage({ id, type: "ERROR", error: err.message });
        }
      } else if (type === "GENERATE_KEYPAIR") {
        try {
          const pubKey = vmNode.generate_client_keypair();
          parentPort.postMessage({ id, type: "KEYPAIR_SUCCESS", publicKey: Array.from(pubKey) });
        } catch (err) {
          parentPort.postMessage({ id, type: "KEYPAIR_ERROR", error: err.message });
        }
      } else if (type === "SIGN_REQUEST") {
        if (!isReadyNode) {
          parentPort.postMessage({ id, type: "SIGN_ERROR", error: "VM not initialized" });
          return;
        }
        try {
          const { method, url, bodyStr, timestamp } = payload;
          const signatureHex = vmNode.sign_request(method, url, bodyStr || "", timestamp);
          if (signatureHex === "uninitialized") {
            throw new Error("WASM crypto not properly initialized");
          }
          parentPort.postMessage({ id, type: "SIGN_SUCCESS", signature: signatureHex, timestamp });
        } catch (err) {
          parentPort.postMessage({ id, type: "SIGN_ERROR", error: err.message });
        }
      }
    });
    parentPort.postMessage({ type: "READY" });
  }
  if (!isNode && typeof self !== "undefined") {
    const workerInitTime = performance.now();
    let isReady = false;
    let globalStegoImage = null;
    let cachedNativeData = null;
    self.native_call = (id, argsJson) => {
      return nativeCallRouter(id, argsJson, cachedNativeData, workerInitTime);
    };
    const randomHex = (len) => {
      let hex = "";
      const chars = "0123456789abcdef";
      for (let i = 0; i < len; i++) {
        hex += chars[Math.floor(Math.random() * 16)];
      }
      return hex;
    };
    self.onmessage = async (e) => {
      const { type, payload } = e.data;
      if (type === "INIT") {
        try {
          let { vmCoreBytes, stegoImageBytes, imageWidth, imageHeight, sessionSeedHex, fingerprintHex, epochDay, devMode, websocketUrl, websocketAuth, nativeData, clientPrivateKey } = payload;
          const t0 = performance.now();
          const vmCoreBytesArray = vmCoreBytes instanceof Uint8Array ? vmCoreBytes : ArrayBuffer.isView(vmCoreBytes) ? new Uint8Array(vmCoreBytes.buffer, vmCoreBytes.byteOffset, vmCoreBytes.byteLength) : new Uint8Array(vmCoreBytes);
          const stegoImageBytesArray = stegoImageBytes instanceof Uint8Array ? stegoImageBytes : ArrayBuffer.isView(stegoImageBytes) ? new Uint8Array(stegoImageBytes.buffer, stegoImageBytes.byteOffset, stegoImageBytes.byteLength) : new Uint8Array(stegoImageBytes);
          const checkTiming = () => {
            const delta = performance.now() - t0;
            if (devMode !== true && delta > 50) {
              try {
                const first = vmCoreBytesArray[0];
                if (vmCoreBytesArray.length > 0 && first !== void 0) {
                  vmCoreBytesArray[0] = first ^ 255;
                }
              } catch (err) {
              }
              try {
                const first = stegoImageBytesArray[0];
                if (stegoImageBytesArray.length > 0 && first !== void 0) {
                  stegoImageBytesArray[0] = first ^ 255;
                }
              } catch (err) {
              }
              sessionSeedHex = randomHex(64);
              fingerprintHex = randomHex(64);
              return true;
            }
            return false;
          };
          checkTiming();
          await __wbg_init({ module_or_path: vmCoreBytesArray });
          checkTiming();
          const hexToBytes = (hex) => new Uint8Array((hex.match(/.{1,2}/g) || []).map((byte) => parseInt(byte, 16)));
          let seedBytes = hexToBytes(sessionSeedHex);
          let fpBytes = hexToBytes(fingerprintHex);
          let stegoBytes = stegoImageBytesArray;
          if (checkTiming()) {
            seedBytes = hexToBytes(sessionSeedHex);
            fpBytes = hexToBytes(fingerprintHex);
            stegoBytes = stegoImageBytesArray;
          }
          if (websocketUrl) {
            const ws = new WebSocket(websocketUrl);
            ws.binaryType = "arraybuffer";
            let wsErrorSent = false;
            ws.onopen = () => {
              if (websocketAuth) {
                ws.send(websocketAuth);
              }
            };
            ws.onmessage = (event) => {
              try {
                const keyBuffer = new Uint8Array(event.data);
                if (keyBuffer.length !== 32) {
                  throw new Error(`Invalid key length: ${keyBuffer.length}`);
                }
                init_crypto_with_key(
                  keyBuffer,
                  seedBytes,
                  fpBytes,
                  epochDay
                );
                globalStegoImage = stegoBytes;
                isReady = true;
                cachedNativeData = nativeData;
                self.postMessage({ type: "INIT_SUCCESS" });
                ws.close();
              } catch (err) {
                if (!wsErrorSent) {
                  wsErrorSent = true;
                  self.postMessage({ type: "INIT_ERROR", error: err.message });
                }
                ws.close();
              }
            };
            ws.onerror = (err) => {
              if (!wsErrorSent) {
                wsErrorSent = true;
                self.postMessage({ type: "INIT_ERROR", error: "WebSocket connection failed" });
              }
            };
            ws.onclose = () => {
              if (!isReady && !wsErrorSent) {
                wsErrorSent = true;
                self.postMessage({ type: "INIT_ERROR", error: "WebSocket closed prematurely" });
              }
            };
          } else {
            init_crypto(
              stegoBytes,
              imageWidth,
              imageHeight,
              seedBytes,
              fpBytes,
              epochDay
            );
            if (clientPrivateKey) {
              set_client_private_key(new Uint8Array(clientPrivateKey));
            }
            globalStegoImage = stegoBytes;
            isReady = true;
            cachedNativeData = nativeData;
            self.postMessage({ type: "INIT_SUCCESS" });
          }
        } catch (err) {
          self.postMessage({ type: "INIT_ERROR", error: err.message });
        }
      } else if (type === "EXECUTE") {
        if (!isReady) {
          self.postMessage({ type: "EXECUTE_ERROR", error: "VM not initialized" });
          return;
        }
        try {
          const { bytecode, opcodeMap, handshakeHeader, input } = payload;
          const handshakeBytes = handshakeHeader ? new Uint8Array(handshakeHeader) : globalStegoImage || new Uint8Array(0);
          const resultJson = execute(
            new Uint8Array(bytecode),
            handshakeBytes,
            JSON.stringify(Array.isArray(input) ? input : [input]),
            new Uint8Array(opcodeMap)
          );
          self.postMessage({ type: "EXECUTE_SUCCESS", result: resultJson });
        } catch (err) {
          self.postMessage({ type: "EXECUTE_ERROR", error: err.message });
        }
      } else if (type === "GENERATE_KEYPAIR") {
        try {
          const pubKey = generate_client_keypair();
          self.postMessage({ type: "KEYPAIR_SUCCESS", publicKey: Array.from(pubKey) });
        } catch (err) {
          self.postMessage({ type: "KEYPAIR_ERROR", error: err.message });
        }
      } else if (type === "SIGN_REQUEST") {
        if (!isReady) {
          self.postMessage({ type: "SIGN_ERROR", error: "VM not initialized" });
          return;
        }
        try {
          const { method, url, bodyStr, timestamp } = payload;
          const signatureHex = sign_request(method, url, bodyStr || "", timestamp);
          if (signatureHex === "uninitialized") {
            throw new Error("WASM crypto not properly initialized");
          }
          self.postMessage({ type: "SIGN_SUCCESS", signature: signatureHex, timestamp });
        } catch (err) {
          self.postMessage({ type: "SIGN_ERROR", error: err.message });
        }
      }
    };
    self.postMessage({ type: "READY" });
  }
})();
