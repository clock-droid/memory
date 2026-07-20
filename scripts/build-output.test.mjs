import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ENTRY_NAME_TEMPLATE,
  injectRuntimeAssets,
  resolveBuildOutputs,
} from './build-output.mjs';

const root = path.resolve('/project');
const dist = path.join(root, 'dist');
const entryPoint = path.join(root, 'src/main.tsx');

function buildMetafile() {
  const javascript = path.join(dist, 'assets/main-A1B2C3D4.js');
  const stylesheet = path.join(dist, 'assets/main-E5F6G7H8.css');
  return {
    outputs: {
      [javascript]: {
        entryPoint,
        cssBundle: stylesheet,
      },
      [stylesheet]: {},
    },
  };
}

describe('content-hashed build outputs', () => {
  it('requires content hashes in entry filenames', () => {
    expect(ENTRY_NAME_TEMPLATE).toContain('[hash]');
  });

  it('derives runtime and precache files from the esbuild metafile', () => {
    expect(resolveBuildOutputs({ metafile: buildMetafile(), root, dist, entryPoint })).toEqual({
      assetFiles: ['assets/main-A1B2C3D4.js', 'assets/main-E5F6G7H8.css'],
      javascriptFile: 'assets/main-A1B2C3D4.js',
      stylesheetFile: 'assets/main-E5F6G7H8.css',
    });
  });

  it('writes the exact hashed runtime URLs into index.html', () => {
    const html = '<body><script type="module" src="/src/main.tsx"></script></body>';
    const output = injectRuntimeAssets(html, {
      javascriptFile: 'assets/main-A1B2C3D4.js',
      stylesheetFile: 'assets/main-E5F6G7H8.css',
    });

    expect(output).toContain('href="/assets/main-E5F6G7H8.css"');
    expect(output).toContain('src="/assets/main-A1B2C3D4.js"');
    expect(output).not.toContain('/assets/main.js');
    expect(output).not.toContain('/src/main.tsx');
  });

  it('rejects outputs that escape the deployment directory', () => {
    const metafile = buildMetafile();
    metafile.outputs[path.join(root, 'outside.js')] = {};

    expect(() => resolveBuildOutputs({ metafile, root, dist, entryPoint }))
      .toThrow('Build output is outside dist');
  });
});
