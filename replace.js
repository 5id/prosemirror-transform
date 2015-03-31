import {Pos, Node, style, inline, slice} from "../model"
import {defineTransform, Result} from "./transform"

function nodesLeft(doc, depth) {
  let nodes = []
  for (let node = doc, i = 0;; i++) {
    nodes.push(node)
    if (i == depth) return nodes
    node = node.content[0]
  }
}

function nodesRight(doc, depth) {
  let nodes = []
  for (let node = doc, i = 0;; i++) {
    nodes.push(node)
    if (i == depth) return nodes
    node = node.content[node.content.length - 1]
  }
}

function compatibleTypes(a, b) {
  return a.contains == b.contains &&
    (a.contains == "block" || a.contains == "inline" || a == b)
}

export function glue(left, leftDepth, right, rightBorder, onChunk, align) {
  let rightDepth = rightBorder.path.length
  let cutDepth = 0
  if (align) {
    cutDepth = Math.max(0, rightDepth - leftDepth)
    leftDepth = rightDepth = Math.min(leftDepth, rightDepth)
  }
  let leftNodes = nodesRight(left, leftDepth)
  let rightNodes = nodesLeft(right, rightDepth)

  for (let iLeft = leftNodes.length - 1,
           iRight = rightNodes.length - 1; iRight >= 0; iRight--) {
    let node = rightNodes[iRight]
    if (node.content.length == 0) {
      if (iRight) rightNodes[iRight - 1].remove(node)
      continue
    }
    let found, target
    for (let i = iLeft; i >= 0; i--) {
      target = leftNodes[i]
      if (compatibleTypes(node.type, target.type) && (iRight > 0 || i == 0)) {
        found = i
        break
      }
    }
    if (found != null) {
      if (onChunk) for (let depth = cutDepth; depth >= 0; depth--) {
        while (rightBorder.path.length > iRight + depth) rightBorder = rightBorder.shorten(null, 1)
        if (depth && rightBorder.offset == 0) continue

        let cur = node
        for (let i = 0; i < depth; i++) cur = cur.content[0]
        let newStart = posRight(left, found)
        if (depth) {
          newStart.path.push(newStart.offset)
          for (let i = 1; i < depth; i++) newStart.path.push(0)
          newStart.offset = 0
        }
        if (onChunk.chunk) onChunk.chunk(rightBorder, cur.maxOffset, newStart)
        else onChunk(rightBorder, cur.maxOffset, newStart)
      }

      let start = target.content.length
      target.pushFrom(node)
      if (node.type.contains == "inline")
        inline.stitchTextNodes(target, start)

      iLeft = found - 1
      cutDepth = 0
      if (iRight) rightNodes[iRight - 1].remove(node)
    } else {
      ++cutDepth
    }
  }
}

function posRight(node, depth) {
  let path = []
  for (let i = 0; i < depth; i++) {
    let offset = node.content.length - 1
    path.push(offset)
    node = node.content[offset]
  }
  return new Pos(path, node.maxOffset)
}

function addDeletedChunksAfter(result, node, pos, ref, depth) {
  if (depth == pos.path.length) {
    result.chunk(pos, node.maxOffset - pos.offset, ref, 0)
  } else {
    let n = pos.path[depth]
    addDeletedChunksAfter(result, node.content[n], pos, ref, depth + 1)
    let size = node.content.length - n - 1
    if (size)
      result.chunk(new Pos(pos.path.slice(0, depth), n + 1), size, ref, 0)
  }
}

function addDeletedChunksBefore(result, node, pos, ref, depth) {
  if (depth == pos.path.length) {
    result.chunk(new Pos(pos.path, 0), pos.offset, ref, 0)
  } else {
    let n = pos.path[depth]
    if (n) result.chunk(new Pos(pos.path.slice(0, depth), 0), n, ref, 0)
    addDeletedChunksBefore(result, node.content[n], pos, ref, depth + 1)
  }    
}

function addDeletedChunks(result, node, from, to, ref, depth = 0) {
  var fromEnd = depth == from.path.length, toEnd = depth == to.path.length
  if (!fromEnd && !toEnd && from.path[depth] == to.path[depth]) {
    addDeletedChunks(result, node.content[from.path[depth]], from, to, ref, depth + 1)
  } else if (fromEnd && toEnd) {
    result.chunk(from, to.offset - from.offset, ref, 0)
  } else {
    let start = from.offset
    if (!fromEnd) {
      start = from.path[depth] + 1
      addDeletedChunksAfter(result, node, from, ref, depth + 1)
    }
    let end = toEnd ? to.offset : to.path[depth]
    if (end != start)
      result.chunk(new Pos(from.path.slice(0, depth), start), end - start, ref, 0)
    if (!toEnd)
      addDeletedChunksBefore(result, node, to, ref, depth + 1)
  }
}

defineTransform("replace", function(doc, params) {
  let from = params.pos, to = params.end || params.pos

  let output = slice.before(doc, from)
  let result = new Result(doc, output, from)
  let right = slice.after(doc, to)
  let depthAfter

  if (params.source) {
    let start = params.from, end = params.to
    let middle = slice.between(params.source, start, end, false)

    let depthOffset = 0
    glue(output, from.path.length, middle, start, (oldPos, size, newPos) => {
      result.chunk(from, 0, newPos, size)
      depthOffset = newPos.path.length - oldPos.path.length
    })
    depthAfter = end.path.length + depthOffset
  } else {
    if (params.text) {
      result.chunk(from, 0, from, params.text.length)
      let block = output.path(from.path), end = block.content.length
      if (!block.type.contains == "inline")
        throw new Error("Can not insert text at a non-inline position")
      let styles = block.type != Node.types.code_block ? params.styles || inline.inlineStylesAt(doc, from) : Node.empty
      block.content.push(Node.text(params.text, styles))
      inline.stitchTextNodes(block, end)
    } else {
      result.chunk(from, 0, from, 0)
    }
    depthAfter = from.path.length
  }
  
  addDeletedChunks(result, doc, from, to, posRight(output, depthAfter))
  glue(output, depthAfter, right, to, result)

  return result
})
