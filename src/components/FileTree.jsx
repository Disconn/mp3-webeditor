import { useState } from 'react';

function DirNode({ node, selectedPath, onSelect, depth }) {
  const [open, setOpen] = useState(depth < 2);

  return (
    <div className="tree-dir">
      <button
        type="button"
        className="tree-row dir"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chev">{open ? '▾' : '▸'}</span>
        <span className="tree-name">{node.name}</span>
      </button>
      {open &&
        (node.children || []).map((child) =>
          child.type === 'dir' ? (
            <DirNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ) : (
            <FileNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
            />
          )
        )}
    </div>
  );
}

function FileNode({ node, selectedPath, onSelect, depth }) {
  const active = selectedPath === node.path;
  return (
    <button
      type="button"
      className={`tree-row file${active ? ' active' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onSelect(node)}
      title={node.path}
    >
      <span className="file-dot" />
      <span className="tree-name">{node.name}</span>
    </button>
  );
}

export default function FileTree({ tree, selectedPath, onSelect }) {
  if (!tree?.length) {
    return <p className="muted pad">Keine MP3-Dateien gefunden.</p>;
  }

  return (
    <div className="file-tree">
      {tree.map((node) =>
        node.type === 'dir' ? (
          <DirNode
            key={node.path}
            node={node}
            selectedPath={selectedPath}
            onSelect={onSelect}
            depth={0}
          />
        ) : (
          <FileNode
            key={node.path}
            node={node}
            selectedPath={selectedPath}
            onSelect={onSelect}
            depth={0}
          />
        )
      )}
    </div>
  );
}
