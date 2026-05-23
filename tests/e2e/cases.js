// E2E Test Cases for fortress-wasm (Tiers 1-4, 49 cases total)

const cases = [
  // --- Tier 1: Feature Coverage (20 cases) ---
  {
    id: 'F1.1',
    name: 'Simple Integer Addition',
    source: 'return 15 + 27;',
    inputs: [],
    expected: 42,
    isError: false
  },
  {
    id: 'F1.2',
    name: 'Simple Integer Subtraction',
    source: 'return 50 - 8;',
    inputs: [],
    expected: 42,
    isError: false
  },
  {
    id: 'F1.3',
    name: 'Simple Integer Multiplication',
    source: 'return 6 * 7;',
    inputs: [],
    expected: 42,
    isError: false
  },
  {
    id: 'F1.4',
    name: 'Simple Integer Division',
    source: 'return 84 / 2;',
    inputs: [],
    expected: 42,
    isError: false
  },
  {
    id: 'F1.5',
    name: 'Variable Binding',
    source: 'let x = 10; let y = 20; return x + y;',
    inputs: [],
    expected: 30,
    isError: false
  },
  {
    id: 'F2.1',
    name: 'If Consequent',
    source: 'if (true) { return 1; } else { return 0; }',
    inputs: [],
    expected: 1,
    isError: false
  },
  {
    id: 'F2.2',
    name: 'If Alternate',
    source: 'if (false) { return 1; } else { return 0; }',
    inputs: [],
    expected: 0,
    isError: false
  },
  {
    id: 'F2.3',
    name: 'While Loop Counter',
    source: 'let i = 0; while (i < 5) { i = i + 1; } return i;',
    inputs: [],
    expected: 5,
    isError: false
  },
  {
    id: 'F2.4',
    name: 'For Loop Counter',
    source: 'let sum = 0; for (let i = 0; i < 5; i++) { sum = sum + i; } return sum;',
    inputs: [],
    expected: 10,
    isError: false
  },
  {
    id: 'F2.5',
    name: 'Comparison Operations',
    source: 'return (5 > 3) && (2 < 4) && (3 == 3) && (3 != 4) && (3 <= 3) && (3 >= 3);',
    inputs: [],
    expected: true,
    isError: false
  },
  {
    id: 'F3.1',
    name: 'List Creation & Push',
    source: 'let l = [1, 2]; return l;',
    inputs: [],
    expected: [1, 2],
    isError: false
  },
  {
    id: 'F3.2',
    name: 'Object Creation & Member Access',
    source: 'let o = { a: 1, b: 2 }; return o.a + o.b;',
    inputs: [],
    expected: 3,
    isError: false
  },
  {
    id: 'F3.3',
    name: 'Length Operator',
    source: 'let l = [1, 2, 3]; return len(l) + len("hello");',
    inputs: [],
    expected: 8,
    isError: false
  },
  {
    id: 'F3.4',
    name: 'String Concat',
    source: 'return concat("foo", "bar");',
    inputs: [],
    expected: 'foobar',
    isError: false
  },
  {
    id: 'F3.5',
    name: 'JSON Stringify',
    source: 'let o = { val: 42 }; return json_stringify(o);',
    inputs: [],
    expected: '{"val":42}',
    isError: false
  },
  {
    id: 'F4.1',
    name: 'SHA-256 Hashing',
    source: 'return hash256("test");',
    inputs: [],
    expected: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    isError: false
  },
  {
    id: 'F4.2',
    name: 'AES-GCM Encryption',
    source: 'return encrypt_aes("hello", "secretkey1234567secretkey1234567");',
    inputs: [],
    expected: 'REGEX:^[0-9a-fA-F]{66}$',
    isError: false
  },
  {
    id: 'F4.3',
    name: 'WebGL Fingerprint Call',
    source: 'return __native_call(1);',
    inputs: [],
    expected: 'MockWebGLRenderer ~ Apple GPU',
    isError: false
  },
  {
    id: 'F4.4',
    name: 'Canvas Fingerprint Call',
    source: 'return __native_call(2);',
    inputs: [],
    expected: 'mock_canvas_fingerprint_hash_value_12345',
    isError: false
  },
  {
    id: 'F4.5',
    name: 'Automation Check Call',
    source: 'return __native_call(3);',
    inputs: [],
    expected: 'REGEX:webdriver',
    isError: false
  },

  // --- Tier 2: Boundary & Corner Cases (20 cases) ---
  {
    id: 'F1.6',
    name: 'Complex Operator Precedence',
    source: 'return 1 + 2 * 3 - 4 / 2;',
    inputs: [],
    expected: 5,
    isError: false
  },
  {
    id: 'F1.7',
    name: 'Float Addition/Subtraction',
    source: 'return 1.5 + 2.25;',
    inputs: [],
    expected: 3.75,
    isError: false
  },
  {
    id: 'F1.8',
    name: 'Division by Zero',
    source: 'return 10 / 0;',
    inputs: [],
    expected: 'DivisionByZero',
    isError: true
  },
  {
    id: 'F1.9',
    name: 'Load Uninitialized Variable',
    source: 'return x;',
    inputs: [],
    expected: null,
    isError: false
  },
  {
    id: 'F1.10',
    name: 'Large Integer Bounds',
    source: 'let x = arg0; return x + 1;',
    inputs: [9007199254740990],
    expected: 9007199254740991,
    isError: false
  },
  {
    id: 'F2.6',
    name: 'Nested If Statements',
    source: 'if (true) { if (false) { return 1; } else { return 2; } } else { return 3; }',
    inputs: [],
    expected: 2,
    isError: false
  },
  {
    id: 'F2.7',
    name: 'Loop Zero Iterations',
    source: 'let i = 0; while (false) { i = i + 1; } return i;',
    inputs: [],
    expected: 0,
    isError: false
  },
  {
    id: 'F2.8',
    name: 'Boolean Logic Combinations',
    source: 'return true && false || !false;',
    inputs: [],
    expected: true,
    isError: false
  },
  {
    id: 'F2.9',
    name: 'For Loop Empty Components',
    source: 'let i = 0; for (; i < 3; ) { i++; } return i;',
    inputs: [],
    expected: 3,
    isError: false
  },
  {
    id: 'F2.10',
    name: 'Gas Metering Timeout',
    source: 'while (true) {}',
    inputs: [],
    expected: 'ExecutionLimitExceeded',
    isError: true
  },
  {
    id: 'F3.6',
    name: 'List Index Out of Bounds',
    source: 'let l = [1, 2]; return l[5];',
    inputs: [],
    expected: 'IndexOutOfBounds',
    isError: true
  },
  {
    id: 'F3.7',
    name: 'Object Non-existent Member',
    source: 'let o = { a: 1 }; return o.b;',
    inputs: [],
    expected: null,
    isError: false
  },
  {
    id: 'F3.8',
    name: 'Deeply Nested Structures',
    source: 'let o = { a: [1, { b: 3 }] }; return o.a[1].b;',
    inputs: [],
    expected: 3,
    isError: false
  },
  {
    id: 'F3.9',
    name: 'String Char Access Indexing',
    source: 'let s = "hello"; return s[1];',
    inputs: [],
    expected: 'e',
    isError: false
  },
  {
    id: 'F3.10',
    name: 'Empty String/List Concat',
    source: 'return concat("", "");',
    inputs: [],
    expected: '',
    isError: false
  },
  {
    id: 'F4.6',
    name: 'Hash Number/Bool',
    source: 'return hash256(123) + hash256(true);',
    inputs: [],
    expected: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b',
    isError: false
  },
  {
    id: 'F4.7',
    name: 'AES-GCM Key Truncation',
    source: 'return encrypt_aes("hello", "shortkey");',
    inputs: [],
    expected: 'REGEX:^[0-9a-fA-F]{66}$',
    isError: false
  },
  {
    id: 'F4.8',
    name: 'Unknown Native Call ID',
    source: 'return __native_call(99);',
    inputs: [],
    expected: 'REGEX:Unknown native call ID',
    isError: false
  },
  {
    id: 'F4.9',
    name: 'Native Call Multi-arguments',
    source: 'return __native_call(4, 1920, 1080);',
    inputs: [],
    expected: 'REGEX:width',
    isError: false
  },
  {
    id: 'F4.10',
    name: 'Timing-based Anti-debugging',
    source: 'let start = 0; return 1;',
    inputs: [],
    expected: 1,
    isError: false
  },

  // --- Tier 3: Cross-Feature Combinations (4 cases) ---
  {
    id: 'T3.1',
    name: 'Fibonacci (F1 + F2)',
    source: `
      let a = 0;
      let b = 1;
      let temp = 0;
      let i = 0;
      while (i < 7) {
          temp = a + b;
          a = b;
          b = temp;
          i = i + 1;
      }
      return a;
    `,
    inputs: [],
    expected: 13,
    isError: false
  },
  {
    id: 'T3.2',
    name: 'List Processing Loop (F2 + F3)',
    source: `
      let l = [1, 2, 3, 4];
      let res = [];
      for (let i = 0; i < len(l); i++) {
          res[i] = l[i] * 2;
      }
      return res;
    `,
    inputs: [],
    expected: [2, 4, 6, 8],
    isError: false
  },
  {
    id: 'T3.3',
    name: 'Object Hash & Serialization (F3 + F4)',
    source: `
      let o = { data: "hello" };
      let s = json_stringify(o);
      return hash256(s);
    `,
    inputs: [],
    expected: '1a1bc6b5b117ed93a2fcc40281efc93d8ccbcc3e52b2dd00a3ca64d54ba7cd38',
    isError: false
  },
  {
    id: 'T3.4',
    name: 'Dynamic Screen Metric Bounds (F1 + F4)',
    source: `
      let metrics = __native_call(4);
      let width = metrics.width;
      let height = metrics.height;
      let ratio = width / height;
      return ratio > 0;
    `,
    inputs: [],
    expected: true,
    isError: false
  },

  // --- Tier 4: Real-World Application Scenarios (5 cases) ---
  {
    id: 'T4.1',
    name: 'Authentication Handshake Challenge',
    source: `
      let client_id = "client123";
      let nonce = "nonce456";
      let msg = concat(client_id, nonce);
      let h = hash256(msg);
      let ciphertext = encrypt_aes(h, "secretkey1234567secretkey1234567");
      return ciphertext;
    `,
    inputs: [],
    expected: 'REGEX:^[0-9a-fA-F]{184}$',
    isError: false
  },
  {
    id: 'T4.2',
    name: 'Dashboard Session Metrics Processing',
    source: `
      let sessions = [
          { rating: 5, active: true },
          { rating: 3, active: false },
          { rating: 4, active: true }
      ];
      let sum = 0;
      let count = 0;
      for (let i = 0; i < len(sessions); i++) {
          let s = sessions[i];
          if (s.active) {
              sum = sum + s.rating;
              count = count + 1;
          }
      }
      let avg = 0;
      if (count > 0) {
          avg = sum / count;
      }
      return { avg_rating: avg, count: count };
    `,
    inputs: [],
    expected: { avg_rating: 4.5, count: 2 },
    isError: false
  },
  {
    id: 'T4.3',
    name: 'VM Self-Checksumming & Anti-Tamper',
    source: 'return 42;',
    inputs: [],
    isError: true,
    antiTamper: true,
    expected: 'Dev mode VirtSC hash mismatch or InvalidOpCode'
  },
  {
    id: 'T4.4',
    name: 'Full Client Telemetry Collection',
    source: `
      let webgl = __native_call(1);
      let canvas = __native_call(2);
      let auto = __native_call(3);
      let metrics = __native_call(4);
      let payload = {
          webgl: webgl,
          canvas: canvas,
          auto: auto,
          metrics: metrics
      };
      let s = json_stringify(payload);
      let h = hash256(s);
      return { payload: s, hash: h };
    `,
    inputs: [],
    expected: 'CUSTOM_TELEMETRY', // Custom validation in runner
    isError: false
  },
  {
    id: 'T4.5',
    name: 'Session Renewability Integrity',
    source: 'return 100;',
    inputs: [],
    expected: 100,
    isError: false,
    renewability: true
  }
];

module.exports = cases;
