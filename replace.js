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

export function join(left, leftDepth, right, rightDepth, f) {
  let leftNodes = nodesRight(left, leftDepth)
  let rightNodes = nodesLeft(right, rightDepth)
  for (let iLeft = leftNodes.length - 1,
           iRight = rightNodes.length - 1; iRight >= 0; iRight--) {
    let node = rightNodes[iRight];
    if (node.content.length == 0) {
      if (iRight) rightNodes[iRight - 1].remove(node)
      continue
    }
    for (let i = iLeft; i >= 0; i--) {
      let other = leftNodes[i]
      if (compatibleTypes(node.type, other.type) && (iRight > 0 || i == 0)) {
        if (f) f(node, iRight, other, i)
        let start = other.content.length
        other.pushFrom(node)
        if (node.type.contains == "inline")
          inline.stitchTextNodes(other, start)
        iLeft = i - 1
        if (iRight) rightNodes[iRight - 1].remove(node)
        break
      }
    }
  }
}

function joinInserted(left, leftDepth, right, rightDepth) {
  let endPos, endPosInline
  join(left, leftDepth, right, rightDepth, function(from, _fromDepth, to, toDepth) {
    let offset
    if (endPosInline = to.type.contains == "inline")
      offset = to.size + from.size
    else
      offset = to.content.length + from.content.length
    endPos = new Pos(pathRight(left, toDepth), offset)
  })
  return {pos: endPos, inline: endPosInline}
}

function pathRight(node, depth) {
  if (depth == 0) return []
  let offset = node.content.length - 1
  let inner = pathRight(node.content[offset], depth - 1)
  inner.unshift(offset)
  return inner
}

export function joinAndTrack(result, base, left, leftDepth, right, rightDepth, align) {
  let spine = []
  for (let i = 0, node = right; i <= rightDepth; i++) {
    spine.push(node)
    node = node.content[0]
  }

  if (align)
    leftDepth = rightDepth = Math.min(leftDepth, rightDepth)

  join(left, leftDepth, right, rightDepth, function(from, fromDepth, to, toDepth) {
    let pathToOutput = pathRight(left, toDepth)
    while (fromDepth < spine.length) {
      let  node = spine.pop(), len = spine.length
      while (base.path.length > len) base = base.shorten()
      if (fromDepth < len && base.offset == 0) continue
      let inline = node.type.contains == "inline"

      let newStart
      if (fromDepth < len) {
        let newPath = pathToOutput.slice()
        newPath.push(inline ? to.size : to.content.length)
        for (let i = fromDepth + 1; i < len; i++) newPath.push(0)
        newStart = new Pos(newPath, 0)
      } else {
        newStart = new Pos(pathToOutput, inline ? to.size : to.content.length)
      }

      result.chunk(base, inline ? node.size : node.content.length, newStart)
    }
  })
}

function addDeletedChunksAfter(result, node, pos, depth) {
  if (depth == pos.path.length) {
    result.chunkDeleted(pos, (node.type.contains == "inline" ? node.size : node.content.length) - pos.offset)
  } else {
    let n = pos.path[depth]
    addDeletedChunksAfter(result, node.content[n], pos, depth + 1)
    let size =  node.content.length - n - 1
    if (size)
      result.chunkDeleted(new Pos(pos.path.slice(0, depth), n + 1), size)
  }
}

function addDeletedChunksBefore(result, node, pos, depth) {
  if (depth == pos.path.lengh) {
    result.chunkDeleted(new Pos(pos.path, 0), pos.offset)
  } else {
    let n = pos.path[depth]
    if (n)
      result.chunkDeleted(new Pos(pos.path.slice(0, depth), 0), n)
    addDeletedChunksBefore(result, node.content[n], pos, depth + 1)
  }    
}

function addDeletedChunks(result, node, from, to, depth = 0) {
  var fromEnd = depth == from.path.length, toEnd = depth == to.path.length
  if (!fromEnd && !toEnd && from.path[depth] == to.path[depth]) {
    addDeletedChunks(result, node.content[from.path[depth]], from, to, depth + 1)
  } else if (fromEnd && toEnd) {
    if (to.offset != from.offset)
      result.chunkDeleted(from, to.offset - from.offset)
  } else {
    let start = from.offset
    if (!fromEnd) {
      start = from.path[depth] + 1
      addDeletedChunksAfter(result, node, from, depth + 1)
    }
    let end = toEnd ? to.offset : to.path[depth]
    if (end != start)
      result.chunkDeleted(new Pos(from.path.slice(0, depth), start), end - start)
    if (!toEnd)
      addDeletedChunksAfter(result, node, to, depth + 1)
  }
}

defineTransform("replace", function(doc, params) {
  let from = params.pos, to = params.end || params.pos

  let output = slice.before(doc, from)
  let result = new Result(doc, output, from)
  let right = slice.after(doc, to)
  addDeletedChunks(result, doc, from, to)

  if (params.source) {
    let start = params.from, end = params.to
    let collapsed = [0]
    let middle = slice.between(params.source, start, end, collapsed)

    let {pos: endPos, inline: endPosInline} =
        joinInserted(output, from.path.length, middle, start.path.length - collapsed[0]) || params.to
    let endDepth = endPos.path.length
    joinAndTrack(result, to, output, end.path.length - collapsed[0] + endDepth, right, to.path.length)
  } else {
    if (params.text) {
      let block = output.path(from.path), end = block.content.length
      if (!block.type.contains == "inline")
        throw new Error("Can not insert text at a non-inline position")
      let styles = block.type != Node.types.code_block ? params.styles || inline.inlineStylesAt(doc, from) : Node.empty
      block.content.push(Node.text(params.text, styles))
      inline.stitchTextNodes(block, end)
    }
    joinAndTrack(result, to, output, from.path.length, right, to.path.length)
  }

  return result
})
