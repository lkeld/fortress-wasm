export const stdlibSource = `
fn map_new() {
    let m = {};
    m.keys = [];
    m.values = [];
    m.size = 0;
    return m;
}

fn map_set(m, key, value) {
    let i = 0;
    while (i < len(m.keys)) {
        if (m.keys[i] == key) { 
            m.values[i] = value; 
            return m; 
        }
        i = i + 1;
    }
    m.keys = listPush(m.keys, key);
    m.values = listPush(m.values, value);
    m.size = m.size + 1;
    return m;
}

fn map_get(m, key) {
    let i = 0;
    while (i < len(m.keys)) {
        if (m.keys[i] == key) { 
            return m.values[i]; 
        }
        i = i + 1;
    }
    return null;
}

fn map_has(m, key) {
    let i = 0;
    while (i < len(m.keys)) {
        if (m.keys[i] == key) { 
            return true; 
        }
        i = i + 1;
    }
    return false;
}

fn map_delete(m, key) {
    let nk = []; 
    let nv = []; 
    let i = 0;
    let deleted = false;
    while (i < len(m.keys)) {
        if (m.keys[i] != key) { 
            nk = listPush(nk, m.keys[i]); 
            nv = listPush(nv, m.values[i]); 
        } else {
            deleted = true;
        }
        i = i + 1;
    }
    m.keys = nk; 
    m.values = nv; 
    m.size = len(nk);
    return m;
}

fn map_clear(m) {
    m.keys = [];
    m.values = [];
    m.size = 0;
    return m;
}

fn map_keys(m) { 
    return m.keys; 
}

fn map_values_list(m) { 
    return m.values; 
}

fn set_new() { 
    let s = {}; 
    s.values = []; 
    s.size = 0; 
    return s; 
}

fn set_add(s, value) {
    let i = 0;
    while (i < len(s.values)) {
        if (s.values[i] == value) { 
            return s; 
        }
        i = i + 1;
    }
    s.values = listPush(s.values, value);
    s.size = s.size + 1;
    return s;
}

fn set_has(s, value) {
    let i = 0;
    while (i < len(s.values)) {
        if (s.values[i] == value) { 
            return true; 
        }
        i = i + 1;
    }
    return false;
}

fn set_delete(s, value) {
    let nv = []; 
    let i = 0;
    let deleted = false;
    while (i < len(s.values)) {
        if (s.values[i] != value) { 
            nv = listPush(nv, s.values[i]); 
        } else {
            deleted = true;
        }
        i = i + 1;
    }
    s.values = nv; 
    s.size = len(nv);
    return s;
}

fn set_clear(s) {
    s.values = [];
    s.size = 0;
    return s;
}

fn set_values_list(s) { 
    return s.values; 
}
`;
