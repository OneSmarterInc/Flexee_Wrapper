## Preface

A few years ago I was standing in a bookstore holding a systems analysis textbook that weighed more than my laptop. Eight hundred pages. Forty-one chapters. A chapter on PERT charts, another on JAD facilitation, a third on object persistence frameworks. It was thorough. It was also, I knew from having assigned books exactly like it, mostly unread.

We assign the eight-hundred-page book, the students buy it or find it, and then they read the four chapters that map to the assignments. Nobody reads a textbook cover to cover. Not students. Not faculty either — I've taught from books whose middle third I never opened.

So this book is short on purpose.

Twelve chapters, about twenty-seven thousand words. You could read the whole thing in an afternoon, and I would rather you did that than skim two hundred pages of a book that covers everything. What's here is what an analyst actually does: find out what people need, model it three different ways, design something someone can build, and check that it works. What is not here — Gantt charts, cost-benefit analysis, a survey of eleven methodologies — is absent because you can learn any of it in twenty minutes on the day you need it, and because including it would have doubled the length while adding nothing you'd remember.

I should be honest about who's implicated in this. I am the one who assigned those books. For years I taught a course where the reading was comprehensive and the learning was not, and I told myself the gap was the students' problem. It was not. If the material is structured so that nobody reads it, then it is structured wrong, and the person who chose the structure is me.

There's one more thing that shapes this book, and it is the reason the whole thing holds together.

Every chapter uses the same example. A university course-registration system — students, courses, sections, prerequisites, the registrar's office. You already understand the domain, which means none of your attention goes to figuring out what a widget is or how a car dealership works. All of it goes to the technique.

And one requirement runs the whole length of the book. In Chapter 2 it appears as R-01 in a requirements catalog: a student cannot enroll without the prerequisite. In Chapter 3 it becomes a use case and a branch in an activity diagram. In Chapter 4 it becomes a rule in a decision table. In Chapter 5 it constrains the data model. In Chapter 6 it is a message beside a form field. In Chapter 10 it is a test case with an expected result. Same rule, six forms, no restating.

That thread is the argument of the book. Traceability is what you get when a single requirement survives the journey from an interview to a test, and you can still see it at every stop along the way. Memorizing the definition does none of that work. I could have written a chapter about traceability. Instead the book demonstrates it, and you'll notice you understood it somewhere around Chapter 6 without ever being told.

Systems analysis has a reputation among students as the course with the diagrams. Draw the DFD, balance the levels, resolve the many-to-many, get the marks. That's not wrong, exactly. The notations are real and you should learn them. But the notations are not the discipline.

The discipline is judgment. Which of these two people is telling me the truth about how ordering works. What nobody mentioned because nobody asked. Whether this is a requirement or somebody's preference. Whether to build or buy, and what would change the answer. Those questions do not have rubrics, and they are what the profession actually pays for.

Economic historians would recognize the pattern in what's happening to this field right now. Every technology wave disrupts the service layer built on the one before it. The telephone took the telegram messenger. The spreadsheet took whole floors of bookkeepers. The internet took the travel agent. AI is doing it again, and the roles most exposed are the ones that consist of coordination — tracking, translating, handing work between specialists. A good deal of what we've traditionally taught as systems analysis lives in exactly that category.

What survives is harder to teach. Reading a situation. Knowing which question not to ask. Owning a decision when it goes wrong. The book's last chapter takes this on directly, and its conclusion is one I didn't expect when I started writing: most of the problems that look like they need artificial intelligence turn out to be problems with what somebody never wrote down.

Which leaves two questions I'd ask you to carry through the twelve chapters.

When you've learned the notations — and they're learnable in a few weeks — what is the part of this work that a tool cannot do for you?

And when you're the analyst in the room and the client asks for something that won't work, what exactly are you going to say?

*Vikram Sethi*
*Dayton, Ohio*
