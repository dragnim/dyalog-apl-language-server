⍝ Hover over any glyph below. Type a backtick to get the glyph list.

mean←{(+/⍵)÷≢⍵}
squares←{⍵*2}⍳10
shape←⍴3 4⍴⍳12
⎕IO←0

⍝ The line below is missing a closing brace, so it should get a red squiggle.
broken←{(+/⍵)÷≢⍵

⍝ Highlighting check: a string with a lamp inside it, and a label.
msg←'⍝ this is text, not a comment'
nums←¯3.5e2 1J2 0.5
sums←+/¨(1 2)(3 4)
start:→0×⍳0
:If 1=⎕IO ⋄ ⎕←'index origin is one' ⋄ :EndIf
