/**
 * test/channels/web/workspace-file-service.test.ts
 *
 * High-value coverage for workspace file read/write/upload paths.
 */

import { expect, test } from "bun:test";
import "../../helpers.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { gzipSync } from "zlib";

import { zipSync, strToU8 } from "fflate";

import { initDatabase } from "../../../src/db.js";
import { handleWorkspaceStat, handleWorkspaceTree } from "../../../src/channels/web/handlers/workspace.js";
import { WorkspaceFileService } from "../../../src/channels/web/workspace/file-service.js";
import { getWorkspaceGitBranch } from "../../../src/channels/web/workspace/git-branch.js";
import { WORKSPACE_DIR } from "../../../src/core/config.js";

function createTarBuffer(entries: Array<{ name: string; content: string }>): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const content = Buffer.from(entry.content, "utf8");
    const header = Buffer.alloc(512, 0);
    Buffer.from(entry.name).copy(header, 0, 0, Math.min(Buffer.byteLength(entry.name), 100));
    Buffer.from("0000777\0", "ascii").copy(header, 100);
    Buffer.from("0000000\0", "ascii").copy(header, 108);
    Buffer.from("0000000\0", "ascii").copy(header, 116);
    Buffer.from(sizeToTarOctal(content.length), "ascii").copy(header, 124);
    Buffer.from("00000000000\0", "ascii").copy(header, 136);
    header[156] = "0".charCodeAt(0);
    Buffer.from("ustar\0", "ascii").copy(header, 257);
    Buffer.from("00", "ascii").copy(header, 263);
    Buffer.from("agent\0", "ascii").copy(header, 265);
    Buffer.from("agent\0", "ascii").copy(header, 297);
    for (let i = 148; i < 156; i += 1) header[i] = 0x20;
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    Buffer.from(checksum.toString(8).padStart(6, "0") + "\0 ", "ascii").copy(header, 148);
    blocks.push(header);
    blocks.push(content);
    const remainder = content.length % 512;
    if (remainder !== 0) blocks.push(Buffer.alloc(512 - remainder, 0));
  }

  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

function sizeToTarOctal(size: number): string {
  return size.toString(8).padStart(11, "0") + "\0";
}

function setupWorkspaceDir() {
  initDatabase();

  const prefix = `workspace-file-service-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const base = join(WORKSPACE_DIR, prefix);
  mkdirSync(base, { recursive: true });

  const cleanup = () => {
    rmSync(base, { recursive: true, force: true });
  };

  return { prefix, base, cleanup, service: new WorkspaceFileService() };
}

test("getFile handles invalid, directory, text/json/image, archive and binary modes", () => {
  const { prefix, base, cleanup, service } = setupWorkspaceDir();
  try {
    writeFileSync(join(base, "note.txt"), "hello\nworld\n", "utf8");
    writeFileSync(join(base, "raw.json"), '{"a":1}', "utf8");
    writeFileSync(join(base, "binary.bin"), Buffer.from([0, 159, 146, 150]));
    writeFileSync(join(base, "image.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    writeFileSync(join(base, "bundle.zip"), Buffer.from(zipSync({ "notes/readme.txt": strToU8("hello"), "data.json": strToU8('{"a":1}') })));
    writeFileSync(join(base, "archive.tar.gz"), gzipSync(createTarBuffer([
      { name: "docs/readme.txt", content: "hello tar" },
      { name: "report.csv", content: "a,b\n1,2\n" },
    ])));

    expect(service.getFile("../../etc/passwd").status).toBe(400);
    expect(service.getFile(prefix).status).toBe(400); // directory path

    const text = service.getFile(`${prefix}/note.txt`);
    expect(text.status).toBe(200);
    expect((text.body as any).kind).toBe("text");
    expect((text.body as any).text).toContain("hello");

    const json = service.getFile(`${prefix}/raw.json`);
    expect(json.status).toBe(200);
    expect((json.body as any).text).toContain('\n  "a": 1\n');

    const image = service.getFile(`${prefix}/image.png`);
    expect(image.status).toBe(200);
    expect((image.body as any).kind).toBe("image");
    expect((image.body as any).url).toContain(`/workspace/raw?path=${encodeURIComponent(`${prefix}/image.png`)}`);

    const zipPreview = service.getFile(`${prefix}/bundle.zip`);
    expect(zipPreview.status).toBe(200);
    expect((zipPreview.body as any).kind).toBe("text");
    expect((zipPreview.body as any).text).toContain(`ZIP archive: ${prefix}/bundle.zip`);
    expect((zipPreview.body as any).text).toContain("notes/readme.txt");
    expect((zipPreview.body as any).text).toContain("data.json");

    const tarPreview = service.getFile(`${prefix}/archive.tar.gz`);
    expect(tarPreview.status).toBe(200);
    expect((tarPreview.body as any).kind).toBe("text");
    expect((tarPreview.body as any).text).toContain(`tar.gz archive: ${prefix}/archive.tar.gz`);
    expect((tarPreview.body as any).text).toContain("docs/readme.txt");
    expect((tarPreview.body as any).text).toContain("report.csv");

    const binaryPreview = service.getFile(`${prefix}/binary.bin`);
    expect(binaryPreview.status).toBe(200);
    expect((binaryPreview.body as any).kind).toBe("binary");

    const binaryEdit = service.getFile(`${prefix}/binary.bin`, null, "edit");
    expect(binaryEdit.status).toBe(400);
    expect((binaryEdit.body as any).error).toContain("Binary file cannot be edited");
  } finally {
    cleanup();
  }
});

test("updateFile/deleteFile and getRaw handle success and errors", () => {
  const { prefix, base, cleanup, service } = setupWorkspaceDir();
  try {
    writeFileSync(join(base, "edit.txt"), "before", "utf8");
    mkdirSync(join(base, "dir"), { recursive: true });

    expect(service.getRaw(`${prefix}/missing.txt`).status).toBe(404);

    const raw = service.getRaw(`${prefix}/edit.txt`);
    expect(raw.status).toBe(200);
    expect(raw.contentType).toBe("text/plain");
    expect(raw.download).toBe(false);

    const rawDownload = service.getRaw(`${prefix}/edit.txt`, true);
    expect(rawDownload.status).toBe(200);
    expect(rawDownload.download).toBe(true);
    expect(rawDownload.filename).toBe("edit.txt");

    expect(service.updateFile(`${prefix}/edit.txt`, undefined as any).status).toBe(400);
    expect(service.updateFile(`${prefix}/missing.txt`, "x").status).toBe(404);

    const updated = service.updateFile(`${prefix}/edit.txt`, "after");
    expect(updated.status).toBe(200);
    expect(readFileSync(join(base, "edit.txt"), "utf8")).toBe("after");

    expect(service.deleteFile(`${prefix}/missing.txt`).status).toBe(404);
    expect(service.deleteFile(`${prefix}/dir`).status).toBe(400);

    const deleted = service.deleteFile(`${prefix}/edit.txt`);
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).deleted).toBe(true);
    expect(service.getRaw(`${prefix}/edit.txt`).status).toBe(404);
  } finally {
    cleanup();
  }
});

test("uploadFile, attachFile, and downloadZip return expected outcomes", async () => {
  const { prefix, base, cleanup, service } = setupWorkspaceDir();
  try {
    mkdirSync(join(base, "uploads"), { recursive: true });
    writeFileSync(join(base, "attach.txt"), "attach me", "utf8");

    const upload = await service.uploadFile(`${prefix}/uploads`, new File(["abc"], "new.txt"));
    expect(upload.status).toBe(200);
    expect((upload.body as any).path).toBe(`${prefix}/uploads/new.txt`);

    const conflict = await service.uploadFile(`${prefix}/uploads`, new File(["abc"], "new.txt"));
    expect(conflict.status).toBe(409);

    const overwrite = await service.uploadFile(`${prefix}/uploads`, new File(["xyz"], "new.txt"), true);
    expect(overwrite.status).toBe(200);
    expect((overwrite.body as any).overwritten).toBe(true);

    mkdirSync(join(base, "uploads", "foldername"), { recursive: true });
    const toDir = await service.uploadFile(`${prefix}/uploads`, new File(["q"], "foldername"), true);
    expect(toDir.status).toBe(400);

    const missingDir = await service.uploadFile(`${prefix}/missing-dir`, new File(["x"], "a.txt"));
    expect(missingDir.status).toBe(404);

    const attached = service.attachFile(`${prefix}/attach.txt`);
    expect(attached.status).toBe(200);
    expect((attached.body as any).media_id).toBeGreaterThan(0);

    const attachDir = service.attachFile(`${prefix}/uploads`);
    expect(attachDir.status).toBe(400);

    const zipDir = await service.downloadZip(`${prefix}/uploads`);
    expect(zipDir.status).toBe(200);
    expect(zipDir.filename).toBe("uploads.zip");

    const zipFile = await service.downloadZip(`${prefix}/attach.txt`);
    expect(zipFile.status).toBe(400);
  } finally {
    cleanup();
  }
});

test("uploadChunk rejects dot-segment upload IDs before deriving staging paths", async () => {
  const { prefix, base, cleanup, service } = setupWorkspaceDir();
  try {
    mkdirSync(join(base, "uploads"), { recursive: true });

    for (const uploadId of [".", ".."] as const) {
      const result = await service.uploadChunk({
        pathParam: `${prefix}/uploads`,
        uploadId,
        chunkIndex: 0,
        chunkTotal: 1,
        fileName: "chunked.txt",
        fileSize: 4,
        overwrite: false,
        data: new TextEncoder().encode("test"),
      });
      expect(result.status).toBe(400);
      expect((result.body as any).error).toBe("Invalid upload ID");
    }
  } finally {
    cleanup();
  }
});

test("workspace file APIs reject symlinks escaping the workspace root", async () => {
  const { prefix, base, cleanup, service } = setupWorkspaceDir();
  const outside = mkdtempSync(join(tmpdir(), "piclaw-workspace-outside-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "do not read", "utf8");
    mkdirSync(join(outside, "drop"), { recursive: true });
    symlinkSync(join(outside, "secret.txt"), join(base, "secret-link.txt"));
    mkdirSync(join(outside, "repo", ".git"), { recursive: true });
    symlinkSync(join(outside, "drop"), join(base, "outside-dir"), "dir");
    symlinkSync(join(outside, "repo"), join(base, "outside-repo"), "dir");
    mkdirSync(join(base, "gitfile-repo"), { recursive: true });
    writeFileSync(join(base, "gitfile-repo", ".git"), `gitdir: ${join(outside, "repo", ".git")}\n`, "utf8");
    writeFileSync(join(base, "moveme.txt"), "move me", "utf8");

    expect(service.getFile(`${prefix}/secret-link.txt`).status).toBe(400);
    expect(service.getRaw(`${prefix}/secret-link.txt`).status).toBe(400);
    expect(service.attachFile(`${prefix}/secret-link.txt`).status).toBe(400);
    expect(service.updateFile(`${prefix}/secret-link.txt`, "changed").status).toBe(400);
    expect(service.deleteFile(`${prefix}/secret-link.txt`).status).toBe(400);
    expect(service.renameFile(`${prefix}/secret-link.txt`, "renamed.txt").status).toBe(400);
    expect(service.moveEntry(`${prefix}/secret-link.txt`, prefix).status).toBe(400);
    expect(service.moveEntry(`${prefix}/moveme.txt`, `${prefix}/outside-dir`).status).toBe(400);

    const statResponse = handleWorkspaceStat(new Request(`http://localhost/workspace/stat?path=${encodeURIComponent(`${prefix}/secret-link.txt`)}`));
    expect(statResponse.status).toBe(400);
    const treeResponse = handleWorkspaceTree(new Request(`http://localhost/workspace/tree?path=${encodeURIComponent(`${prefix}/outside-dir`)}`));
    expect(treeResponse.status).toBe(400);
    const branch = getWorkspaceGitBranch(`${prefix}/outside-repo`, () => "main\n");
    expect(branch).toBeNull();
    const gitfileBranch = getWorkspaceGitBranch(`${prefix}/gitfile-repo`, () => "main\n");
    expect(gitfileBranch).toBeNull();

    const upload = await service.uploadFile(`${prefix}/outside-dir`, new File(["x"], "upload.txt"));
    expect(upload.status).toBe(400);
    expect(service.createFile(`${prefix}/outside-dir`, "created.txt", "x").status).toBe(400);
    const chunk = await service.uploadChunk({
      pathParam: `${prefix}/outside-dir`,
      uploadId: `outside-${Date.now()}`,
      chunkIndex: 0,
      chunkTotal: 1,
      fileName: "chunked.txt",
      fileSize: 1,
      overwrite: false,
      data: new TextEncoder().encode("x"),
    });
    expect(chunk.status).toBe(400);
    expect((await service.downloadZip(`${prefix}/outside-dir`)).status).toBe(400);

    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("do not read");
  } finally {
    rmSync(outside, { recursive: true, force: true });
    cleanup();
  }
});

test("workspace file APIs allow symlinks whose real targets stay inside the workspace", () => {
  const { prefix, base, cleanup, service } = setupWorkspaceDir();
  try {
    mkdirSync(join(base, "real"), { recursive: true });
    writeFileSync(join(base, "real", "inside.txt"), "inside", "utf8");
    symlinkSync(join(base, "real", "inside.txt"), join(base, "inside-link.txt"));

    const preview = service.getFile(`${prefix}/inside-link.txt`);
    expect(preview.status).toBe(200);
    expect((preview.body as any).text).toBe("inside");

    const updated = service.updateFile(`${prefix}/inside-link.txt`, "updated");
    expect(updated.status).toBe(200);
    expect(readFileSync(join(base, "real", "inside.txt"), "utf8")).toBe("updated");
  } finally {
    cleanup();
  }
});

test("uploadChunk assembles a file atomically", async () => {
  const { prefix, base, cleanup, service } = setupWorkspaceDir();
  try {
    mkdirSync(join(base, "uploads"), { recursive: true });

    const chunkA = new TextEncoder().encode("hello ");
    const chunkB = new TextEncoder().encode("world");
    const uploadId = `upload-${Date.now()}`;

    const first = await service.uploadChunk({
      pathParam: `${prefix}/uploads`,
      uploadId,
      chunkIndex: 0,
      chunkTotal: 2,
      fileName: 'chunked.txt',
      fileSize: chunkA.length + chunkB.length,
      overwrite: false,
      data: chunkA,
    });
    expect(first.status).toBe(200);
    expect((first.body as any).complete).toBe(false);

    const second = await service.uploadChunk({
      pathParam: `${prefix}/uploads`,
      uploadId,
      chunkIndex: 1,
      chunkTotal: 2,
      fileName: 'chunked.txt',
      fileSize: chunkA.length + chunkB.length,
      overwrite: false,
      data: chunkB,
    });
    expect(second.status).toBe(200);
    expect((second.body as any).complete).toBe(true);
    expect((second.body as any).path).toBe(`${prefix}/uploads/chunked.txt`);
    expect(readFileSync(join(base, 'uploads', 'chunked.txt'), 'utf8')).toBe('hello world');
  } finally {
    cleanup();
  }
});
