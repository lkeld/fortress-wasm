const fs = require('fs');
const path = require('path');

function parseSemver(versionStr) {
  if (!versionStr) return null;
  const cleaned = versionStr.trim().replace(/^[v=]/, '').trim();
  const withoutBuildMetadata = cleaned.split('+')[0];
  const dashIndex = withoutBuildMetadata.indexOf('-');
  
  let mainPart = withoutBuildMetadata;
  let prerelease = '';
  if (dashIndex !== -1) {
    mainPart = withoutBuildMetadata.slice(0, dashIndex);
    prerelease = withoutBuildMetadata.slice(dashIndex + 1);
  }
  
  const mainParts = mainPart.split('.');
  const major = parseInt(mainParts[0] || '0', 10);
  const minor = parseInt(mainParts[1] || '0', 10);
  const patch = parseInt(mainParts[2] || '0', 10);
  
  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    return null;
  }
  
  return { major, minor, patch, prerelease };
}

function compareSemver(v1Str, v2Str) {
  const v1 = parseSemver(v1Str);
  const v2 = parseSemver(v2Str);
  if (!v1 || !v2) return 0;
  
  if (v1.major !== v2.major) return v1.major - v2.major;
  if (v1.minor !== v2.minor) return v1.minor - v2.minor;
  if (v1.patch !== v2.patch) return v1.patch - v2.patch;
  
  if (!v1.prerelease && v2.prerelease) return 1;
  if (v1.prerelease && !v2.prerelease) return -1;
  if (v1.prerelease && v2.prerelease) {
    const p1 = v1.prerelease.split('.');
    const p2 = v2.prerelease.split('.');
    const len = Math.max(p1.length, p2.length);
    for (let i = 0; i < len; i++) {
      if (i >= p1.length) return -1;
      if (i >= p2.length) return 1;
      
      const id1 = p1[i];
      const id2 = p2[i];
      
      const isNum1 = /^\d+$/.test(id1);
      const isNum2 = /^\d+$/.test(id2);
      
      if (isNum1 && isNum2) {
        const n1 = parseInt(id1, 10);
        const n2 = parseInt(id2, 10);
        if (n1 !== n2) return n1 - n2;
      } else if (isNum1 && !isNum2) {
        return -1;
      } else if (!isNum1 && isNum2) {
        return 1;
      } else {
        if (id1 < id2) return -1;
        if (id1 > id2) return 1;
      }
    }
  }
  return 0;
}

function satisfiesSingle(version, constraint) {
  constraint = constraint.trim();
  if (constraint === '*' || constraint === 'x' || constraint === '') return true;
  
  let op = '';
  let verStr = constraint;
  
  if (constraint.startsWith('>=')) {
    op = '>=';
    verStr = constraint.slice(2);
  } else if (constraint.startsWith('<=')) {
    op = '<=';
    verStr = constraint.slice(2);
  } else if (constraint.startsWith('>')) {
    op = '>';
    verStr = constraint.slice(1);
  } else if (constraint.startsWith('<')) {
    op = '<';
    verStr = constraint.slice(1);
  } else if (constraint.startsWith('^')) {
    op = '^';
    verStr = constraint.slice(1);
  } else if (constraint.startsWith('~')) {
    op = '~';
    verStr = constraint.slice(1);
  } else if (constraint.startsWith('=')) {
    op = '=';
    verStr = constraint.slice(1);
  }
  
  verStr = verStr.trim();
  const hasWildcard = verStr.includes('x') || verStr.includes('*');
  const cleanVerStr = verStr.replace(/[x*]/g, '0');
  
  const v = parseSemver(version);
  const target = parseSemver(cleanVerStr);
  if (!v || !target) return false;
  
  const cmp = compareSemver(version, cleanVerStr);
  
  if (op === '>=') return cmp >= 0;
  if (op === '<=') return cmp <= 0;
  if (op === '>') return cmp > 0;
  if (op === '<') return cmp < 0;
  if (op === '=') {
    if (hasWildcard) {
      const parts = verStr.split('.');
      if (parts[0] !== 'x' && parts[0] !== '*' && parseInt(parts[0], 10) !== v.major) return false;
      if (parts[1] !== undefined && parts[1] !== 'x' && parts[1] !== '*' && parseInt(parts[1], 10) !== v.minor) return false;
      if (parts[2] !== undefined && parts[2] !== 'x' && parts[2] !== '*' && parseInt(parts[2], 10) !== v.patch) return false;
      return true;
    }
    return cmp === 0;
  }
  
  if (op === '^') {
    if (cmp < 0) return false;
    if (target.major > 0) {
      return v.major === target.major;
    } else if (target.minor > 0) {
      return v.major === 0 && v.minor === target.minor;
    } else {
      return v.major === 0 && v.minor === 0 && v.patch === target.patch;
    }
  }
  
  if (op === '~') {
    if (cmp < 0) return false;
    const parts = verStr.split('.');
    if (parts.length === 1 || parts[1] === 'x' || parts[1] === '*') {
      return v.major === target.major;
    }
    return v.major === target.major && v.minor === target.minor;
  }
  
  if (hasWildcard) {
    const parts = verStr.split('.');
    if (parts[0] !== 'x' && parts[0] !== '*' && parseInt(parts[0], 10) !== v.major) return false;
    if (parts[1] !== undefined && parts[1] !== 'x' && parts[1] !== '*' && parseInt(parts[1], 10) !== v.minor) return false;
    if (parts[2] !== undefined && parts[2] !== 'x' && parts[2] !== '*' && parseInt(parts[2], 10) !== v.patch) return false;
    return true;
  }
  return cmp === 0;
}

function satisfies(version, range) {
  if (!range || range === '*' || range === 'x') return true;
  const orGroups = range.split('||');
  for (const group of orGroups) {
    const andParts = group.split(/\s+|&&/).map(p => p.trim()).filter(Boolean);
    let groupSatisfied = true;
    for (const part of andParts) {
      if (!satisfiesSingle(version, part)) {
        groupSatisfied = false;
        break;
      }
    }
    if (groupSatisfied) return true;
  }
  return false;
}

function findInstalledPackageVersion(packageName, startDir) {
  let currentDir = startDir;
  while (true) {
    const pkgPath = path.join(currentDir, 'node_modules', packageName, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.version) {
          return pkg.version;
        }
      } catch (e) {
        // ignore
      }
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  return null;
}

function cleanRangeToVersion(range) {
  if (!range) return null;
  const cleaned = range.trim().replace(/^[\^~>=<]+/, '').trim();
  const match = cleaned.match(/\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?/);
  if (match) {
    return match[0];
  }
  const matchShort = cleaned.match(/\d+\.\d+/);
  if (matchShort) {
    return matchShort[0] + '.0';
  }
  const matchMajor = cleaned.match(/^\d+/);
  if (matchMajor) {
    return matchMajor[0] + '.0.0';
  }
  return null;
}

function resolveFrameworkVersion(targetDir, framework) {
  let packageNames = [];
  const lowerFw = framework.toLowerCase();
  
  if (lowerFw.startsWith('next')) {
    packageNames = ['next'];
  } else if (lowerFw === 'remix') {
    packageNames = ['@remix-run/react', '@remix-run/node', '@react-router/node', '@react-router/react', 'react-router'];
  } else if (lowerFw === 'sveltekit') {
    packageNames = ['@sveltejs/kit'];
  } else if (lowerFw === 'astro') {
    packageNames = ['astro'];
  } else if (lowerFw === 'angular') {
    packageNames = ['@angular/core'];
  } else if (lowerFw === 'solid' || lowerFw === 'solidjs') {
    packageNames = ['solid-js'];
  } else if (lowerFw === 'qwik') {
    packageNames = ['@builder.io/qwik'];
  } else if (lowerFw === 'nuxt') {
    packageNames = ['nuxt'];
  } else if (lowerFw === 'express') {
    packageNames = ['express'];
  } else if (lowerFw === 'fastify') {
    packageNames = ['fastify'];
  } else if (lowerFw === 'hono') {
    packageNames = ['hono'];
  } else if (lowerFw === 'koa') {
    packageNames = ['koa'];
  } else if (lowerFw === 'nestjs') {
    packageNames = ['@nestjs/core'];
  } else {
    packageNames = [framework];
  }

  for (const pkgName of packageNames) {
    const version = findInstalledPackageVersion(pkgName, targetDir);
    if (version) return { version, source: 'node_modules', package: pkgName };
  }

  const pkgPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const pkgName of packageNames) {
        if (deps[pkgName]) {
          const cleaned = cleanRangeToVersion(deps[pkgName]);
          if (cleaned) {
            return { version: cleaned, source: 'package.json', package: pkgName };
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  return { version: '0.0.0', source: 'fallback', package: packageNames[0] };
}

function resolveFrameworkCompatibility(targetDir, framework) {
  const { version, source, package: resolvedPackage } = resolveFrameworkVersion(targetDir, framework);
  
  const features = {};
  const paths = {};
  const canonicalFw = framework.toLowerCase().startsWith('next') ? 'next' : framework.toLowerCase();
  
  if (canonicalFw === 'next') {
    const hasApp = fs.existsSync(path.join(targetDir, 'app')) || 
                   fs.existsSync(path.join(targetDir, 'src/app'));
    
    // App Router is Next.js >= 13 and app folder exists
    let useAppRouter = false;
    if (version === '0.0.0') {
      if (hasApp) {
        useAppRouter = true;
      }
    } else {
      useAppRouter = satisfies(version, '>=13.0.0') && hasApp;
    }
    features.useAppRouter = useAppRouter;
    features.segmentConfig = useAppRouter;
  } else if (canonicalFw === 'remix') {
    const isRR7 = ['react-router', '@react-router/node', '@react-router/react'].includes(resolvedPackage) && 
                  satisfies(version, '>=7.0.0-0');
    features.reactRouter7 = isRR7;
  } else if (canonicalFw === 'angular') {
    // Angular standalone by default >= 17 (or >= 15 if standalone is used/detected)
    features.standalone = satisfies(version, '>=17.0.0');
  } else if (canonicalFw === 'sveltekit') {
    features.sveltekitV2 = satisfies(version, '>=2.0.0');
  } else if (canonicalFw === 'astro') {
    features.astroV5 = satisfies(version, '>=5.0.0');
  }
  
  return {
    framework: canonicalFw,
    version,
    source,
    resolvedPackage,
    features,
    paths
  };
}

module.exports = {
  parseSemver,
  compareSemver,
  satisfies,
  findInstalledPackageVersion,
  cleanRangeToVersion,
  resolveFrameworkCompatibility
};
