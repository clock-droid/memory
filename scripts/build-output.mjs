import path from 'node:path';

export const ENTRY_NAME_TEMPLATE = 'assets/[name]-[hash]';
export const CHUNK_NAME_TEMPLATE = 'assets/chunks/[name]-[hash]';
export const ASSET_NAME_TEMPLATE = 'assets/[name]-[hash]';

function toDistRelativeFile(outputPath, { root, dist }) {
  const absoluteOutput = path.resolve(root, outputPath);
  const relativeOutput = path.relative(dist, absoluteOutput);
  if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
    throw new Error(`Build output is outside dist: ${outputPath}`);
  }
  return relativeOutput.split(path.sep).join('/');
}

export function resolveBuildOutputs({ metafile, root, dist, entryPoint }) {
  const outputs = Object.entries(metafile.outputs);
  const resolvedEntryPoint = path.resolve(entryPoint);
  const entryOutput = outputs.find(([, metadata]) =>
    metadata.entryPoint && path.resolve(root, metadata.entryPoint) === resolvedEntryPoint,
  );

  if (!entryOutput) {
    throw new Error(`Unable to find the JavaScript output for ${entryPoint}.`);
  }

  const [javascriptOutput, entryMetadata] = entryOutput;
  if (!entryMetadata.cssBundle) {
    throw new Error(`Unable to find the stylesheet output for ${entryPoint}.`);
  }

  const javascriptFile = toDistRelativeFile(javascriptOutput, { root, dist });
  const stylesheetFile = toDistRelativeFile(entryMetadata.cssBundle, { root, dist });
  const assetFiles = [...new Set(
    outputs.map(([outputPath]) => toDistRelativeFile(outputPath, { root, dist })),
  )].sort();

  return { assetFiles, javascriptFile, stylesheetFile };
}

export function toPublicUrl(fileName) {
  return `/${fileName}`;
}

export function injectRuntimeAssets(html, { javascriptFile, stylesheetFile }) {
  const sourceEntry = '<script type="module" src="/src/main.tsx"></script>';
  const occurrences = html.split(sourceEntry).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one source entry in index.html, found ${occurrences}.`);
  }

  return html.replace(
    sourceEntry,
    `<link rel="stylesheet" href="${toPublicUrl(stylesheetFile)}" />\n    `
      + `<script type="module" src="${toPublicUrl(javascriptFile)}"></script>`,
  );
}
