import {style, Node, Pos} from "../model"

import {defineStep, TransformResult, Step, Transform} from "./transform"
import {nullMap} from "./map"
import {copyInline, copyStructure, forSpansBetween} from "./tree"

defineStep("addStyle", {
  apply(doc, step) {
    return new TransformResult(copyStructure(doc, step.from, step.to, (node, from, to) => {
      if (node.type.plainText) return node
      return copyInline(node, from, to, node => {
        return new Node.Inline(node.type, node.attrs, style.add(node.styles, step.param), node.text)
      })
    }))
  },
  invert(step, _oldDoc, map) {
    return new Step("removeStyle", step.from, map.map(step.to).pos, null, step.param)
  }
})


Transform.prototype.addStyle = function(from, to, st) {
  let removed = [], added = [], removing = null, adding = null
  forSpansBetween(this.doc, from, to, (span, path, start, end) => {
    let styles = span.styles, rm
    if (style.contains(span.styles, st)) {
      adding = removing = null
    } else {
      path = path.slice()
      if (rm = style.containsType(span.styles, st.type)) {
        if (removing && style.same(removing.param, rm)) {
          removing.to = new Pos(path, end)
        } else {
          removing = new Step("removeStyle", new Pos(path, start), new Pos(path, end), null, rm)
          removed.push(removing)
        }
      }
      if (adding) {
        adding.to = new Pos(path, end)
      } else {
        adding = new Step("addStyle", new Pos(path, start), new Pos(path, end), null, st)
        added.push(adding)
      }
    }
  })
  removed.forEach(s => this.step(s))
  added.forEach(s => this.step(s))
  return this
}

defineStep("removeStyle", {
  apply(doc, step) {
    return new TransformResult(copyStructure(doc, step.from, step.to, (node, from, to) => {
      return copyInline(node, from, to, node => {
        let styles = style.remove(node.styles, step.param)
        return new Node.Inline(node.type, node.attrs, styles, node.text)
      })
    }))
  },
  invert(step, _oldDoc, map) {
    return new Step("addStyle", step.from, map.map(step.to).pos, null, step.param)
  }
})

Transform.prototype.removeStyle = function(from, to, st = null) {
  let matched = [], step = 0
  forSpansBetween(this.doc, from, to, (span, path, start, end) => {
    step++
    let toRemove = null
    if (typeof st == "string") {
      let found = style.containsType(span.styles, st)
      if (found) toRemove = [found]
    } else if (st) {
      if (style.contains(span.styles, st)) toRemove = [st]
    } else {
      toRemove = span.styles
    }
    if (toRemove && toRemove.length) {
      path = path.slice()
      for (let i = 0; i < toRemove.length; i++) {
        let rm = toRemove[i], found
        for (let j = 0; j < matched.length; j++) {
          let m = matched[j]
          if (m.step == step - 1 && style.same(rm, matched[j].style)) found = m
        }
        if (found) {
          found.to = new Pos(path, end)
          found.step = step
        } else {
          matched.push({style: rm, from: new Pos(path, start), to: new Pos(path, end), step: step})
        }
      }
    }
  })
  matched.forEach(m => this.step("removeStyle", m.from, m.to, null, m.style))
  return this
}

Transform.prototype.clearMarkup = function(from, to) {
  let steps = []
  forSpansBetween(this.doc, from, to, (span, path, start, end) => {
    if (span.type != Node.types.text) {
      path = path.slice()
      steps.unshift(new Step("replace", new Pos(path, start), new Pos(path, end)))
    }
  })
  this.removeStyle(from.to)
  steps.forEach(s => this.step(s))
  return this
}
