import type { ReviewTag } from "@/review/review-tags";

/**
 * The two lines a chip's tooltip shows. `what` says how to recognise the thing, `then`
 * says what to do about it — the headings differ by kind ("Symptom / Fix" reads wrong
 * for a technique), which is what `reviewTagDescriptionHeadings` supplies.
 */
export interface ReviewTagDescription {
	what: string;
	then: string;
}

export interface ReviewTagDescriptionHeadings {
	what: string;
	then: string;
}

/**
 * Keyed by lowercased label, the same case-insensitive identity `reviewTagColor` and
 * `buildTagSections` dedup on — so a rules bundle category named "Security" gets the
 * builtin's description for the same reason it gets the builtin's colour.
 *
 * These are the reviewer's crib sheet, not the agent's: nothing here reaches a prompt.
 * The catalog names are canonical, so the model already knows them and pays nothing.
 */
const REVIEW_TAG_DESCRIPTIONS: Record<string, ReviewTagDescription> = {
	// ---------------------------------------------------------------- builtins
	pattern: {
		what: "The code hand-rolls something this codebase already has a shape for, or applies a pattern that does not fit the problem.",
		then: "Point at the existing helper, module or convention it should have followed.",
	},
	"code style": {
		what: "Naming, layout or idiom that fights the surrounding file — readable, but not how this codebase writes it.",
		then: "Name the local convention rather than a personal preference; if a linter could catch it, fix the linter instead.",
	},
	security: {
		what: "Untrusted input reaching a sink: injection, path traversal, deserialization, a secret in code, a weakened check.",
		then: "Say which input reaches which sink and what an attacker gets; ask for validation at the boundary, not at the call site.",
	},
	performance: {
		what: "Work that grows faster than the data: a query in a loop, a scan where a lookup exists, an allocation on a hot path.",
		then: "Name the input size that makes it hurt, then ask for the cheaper structure or a single batched call.",
	},
	"bug risk": {
		what: "Logic that is wrong for an input nobody tried — an off-by-one, a null, an empty collection, an unhandled branch.",
		then: "Give the concrete input that breaks it, so the fix can be tested rather than argued.",
	},
	"error handling": {
		what: "A failure that is swallowed, logged and continued, or turned into a value the caller cannot distinguish from success.",
		then: "Decide who is meant to recover, and make the failure reach them intact.",
	},
	concurrency: {
		what: "Shared state touched from more than one task: a race, a missing await, a lock held across I/O, an unbounded queue.",
		then: "Name the two interleavings that conflict, then ask for the narrowest fix — usually ownership, not a lock.",
	},
	"test coverage": {
		what: "Behaviour that changed with no test that would have failed before the change.",
		then: "Ask for the one case that pins the new behaviour, not for coverage as a number.",
	},
	simplify: {
		what: "The result is right but the route to it is longer than it needs to be — extra state, extra branch, extra layer.",
		then: "Propose the shorter form outright; a simplification without a replacement reads as taste.",
	},
	"breaking change": {
		what: "A signature, schema, route, config key or persisted shape changed in a way existing callers or stored data will not survive.",
		then: "Say who breaks and when they find out, then ask for a migration or a compatible default.",
	},

	// ------------------------------------------------------------------ smells
	"long method": {
		what: "A method long enough that you scroll to read it, usually with comment-headed sections doing separate jobs.",
		then: "Extract Method per section; if locals get in the way, Extract Variable or Replace Method with Method Object first.",
	},
	"large class": {
		what: "One class holding fields and methods for several responsibilities, so most of it is irrelevant to any one caller.",
		then: "Extract Class along the field clusters, or Extract Subclass when the split is by variant.",
	},
	"primitive obsession": {
		what: "Strings and numbers standing in for concepts — a currency as a float, an id as a bare string, a status as an int.",
		then: "Replace Data Value with Object, or Replace Type Code with Class so the type carries the rules.",
	},
	"long parameter list": {
		what: "More than three or four parameters, often several that always travel together or a flag that switches behaviour.",
		then: "Introduce Parameter Object, Preserve Whole Object, or Replace Parameter with Explicit Methods for the flag.",
	},
	"data clumps": {
		what: "The same group of values appearing together in parameter lists and field declarations across the codebase.",
		then: "Extract Class for the group, then Introduce Parameter Object at the call sites.",
	},
	"alternative classes with different interfaces": {
		what: "Two classes doing the same job with different method names, so callers cannot be written against either.",
		then: "Rename Method and Move Method until they match, then Extract Superclass or an interface.",
	},
	"refused bequest": {
		what: "A subclass inherits methods or fields it does not want, often overriding them to throw or do nothing.",
		then: "Push Down the unwanted members, or Replace Inheritance with Delegation when the relationship was never is-a.",
	},
	"switch statements": {
		what: "A switch or if-chain on a type code, repeated in more than one place so every new case is edited several times.",
		then: "Replace Conditional with Polymorphism, or Replace Type Code with State/Strategy when the code changes at runtime.",
	},
	"temporary field": {
		what: "A field only set and used during one algorithm, empty the rest of the object's life.",
		then: "Extract Class for the algorithm and its field, or Replace Method with Method Object.",
	},
	"divergent change": {
		what: "One module changed for unrelated reasons — a new report and a new database column both land in the same class.",
		then: "Extract Class along the reasons-to-change, so each edit touches one of them.",
	},
	"shotgun surgery": {
		what: "One conceptual change forces small edits in many files; miss one and it is silently half-applied.",
		then: "Move Method and Move Field to pull the scattered behaviour into one place, then Inline Class the remains.",
	},
	"parallel inheritance hierarchies": {
		what: "Every new subclass here forces a matching subclass over there.",
		then: "Move Method / Move Field so one hierarchy references the other instead of mirroring it.",
	},
	comments: {
		what: "A comment explaining what the code does, standing in for a name the code could have carried.",
		then: "Extract Method or Extract Variable with the comment as the name; keep comments that explain why.",
	},
	"duplicate code": {
		what: "The same logic in more than one place, so a fix has to be found more than once.",
		then: "Extract Method and pull it up, or Form Template Method when the copies differ in the middle.",
	},
	"data class": {
		what: "A class that is only fields with getters and setters; every rule about its data lives in its callers.",
		then: "Move Method to bring the behaviour in, then Encapsulate Field / Encapsulate Collection and remove the setters.",
	},
	"dead code": {
		what: "A variable, parameter, method or branch nothing reaches — often left behind by an earlier change.",
		then: "Delete it. Version control is the archive; a flag that guards it is dead code with extra steps.",
	},
	"lazy class": {
		what: "A class that no longer does enough to pay for the file, the import and the indirection.",
		then: "Inline Class into its only caller, or Collapse Hierarchy when it is a near-empty subclass.",
	},
	"speculative generality": {
		what: "Abstraction built for a case that has not arrived — a hook with one implementation, an unused parameter, an interface with one class.",
		then: "Collapse Hierarchy, Inline Class, Remove Parameter. Add it back when the second case exists.",
	},
	"feature envy": {
		what: "A method reaches through another object's data more than it touches its own.",
		then: "Move Method to the class that owns the data; if only part of it envies, Extract Method first and move that part.",
	},
	"inappropriate intimacy": {
		what: "Two classes reaching into each other's private parts — bidirectional references, or one built entirely on the other's internals.",
		then: "Move Method / Move Field to split them, Change Bidirectional Association to Unidirectional, or Extract Class for the shared piece.",
	},
	"message chains": {
		what: "A caller walking a chain of objects — a.getB().getC().getD() — which couples it to every link.",
		then: "Hide Delegate so the caller asks once; if the intermediate then does nothing else, watch for Middle Man.",
	},
	"middle man": {
		what: "A class whose methods mostly forward to another object, adding a hop and nothing else.",
		then: "Remove Middle Man and let callers talk to the real object, or Inline Method for the few delegating methods.",
	},
	"incomplete library class": {
		what: "A library almost does what is needed, but the method you want is not there and the class cannot be edited.",
		then: "Introduce Foreign Method for one or two, Introduce Local Extension when there are many.",
	},

	// ----------------------------------------------------------- refactorings
	"extract method": {
		what: "A fragment can be grouped and given a name that says what it does.",
		then: "Moves it into its own method and leaves a call behind — the first move against Long Method.",
	},
	"inline method": {
		what: "The body is as clear as the name, so the method adds a hop and nothing else.",
		then: "Puts the body back at the call sites and deletes the method.",
	},
	"extract variable": {
		what: "An expression is hard to read, or is repeated inside a larger one.",
		then: "Names it in a local variable, so the name explains the expression instead of a comment.",
	},
	"inline temp": {
		what: "A temp holds a simple expression and is used once, adding a name that says nothing.",
		then: "Replaces the temp with the expression itself.",
	},
	"replace temp with query": {
		what: "A temp holds the result of an expression that other methods could use too.",
		then: "Moves the expression into a method and calls it — the enabler for Extract Method when locals block it.",
	},
	"split temporary variable": {
		what: "One variable is assigned more than once for unrelated purposes.",
		then: "Gives each purpose its own variable, so neither name lies about what it holds.",
	},
	"remove assignments to parameters": {
		what: "A parameter is reassigned inside the method, so its name stops meaning what was passed in.",
		then: "Assigns to a local instead, leaving the parameter as the record of the input.",
	},
	"replace method with method object": {
		what: "A long method's locals are too tangled for Extract Method to reach.",
		then: "Turns the method into a class whose fields are those locals; extracting is then ordinary.",
	},
	"substitute algorithm": {
		what: "The method does the right thing by a route that is harder than the one now available.",
		then: "Replaces the body with the clearer algorithm, tests unchanged.",
	},
	"move method": {
		what: "A method uses another class more than its own — the Feature Envy cure.",
		then: "Moves it to the class it envies, leaving a delegating call or nothing at all.",
	},
	"move field": {
		what: "A field is used by another class more than by the one holding it.",
		then: "Moves it to that class and redirects the accesses.",
	},
	"extract class": {
		what: "One class is doing the work of two — a field cluster with its own methods.",
		then: "Creates a second class and moves that cluster into it.",
	},
	"inline class": {
		what: "A class no longer does enough to justify itself.",
		then: "Folds its members into the class that uses it and deletes it.",
	},
	"hide delegate": {
		what: "Callers walk a chain to reach an object's collaborator.",
		then: "Adds a method on the owner so callers ask it directly and stop depending on the link.",
	},
	"remove middle man": {
		what: "A class delegates so much that the indirection costs more than it hides.",
		then: "Deletes the forwarding methods and lets callers use the real object — the inverse of Hide Delegate.",
	},
	"introduce foreign method": {
		what: "A library class is missing a method and cannot be changed, and you need one or two.",
		then: "Adds the method to the client class, taking the library object as its first argument.",
	},
	"introduce local extension": {
		what: "Same as above, but you need several methods and want them to travel together.",
		then: "Creates a subclass or wrapper holding all of them, so clients see one type.",
	},
	"change value to reference": {
		what: "Many equal copies of the same conceptual object exist, and a change to one should be seen by all.",
		then: "Replaces the copies with a single shared instance reached through a factory.",
	},
	"change reference to value": {
		what: "A shared object is small, immutable and awkward to manage — lifecycle cost with no benefit.",
		then: "Turns it into a value object compared by its fields.",
	},
	"duplicate observed data": {
		what: "Domain data lives in the UI layer, so business logic cannot be used without it.",
		then: "Moves the data to a domain object and keeps the UI in sync through an observer.",
	},
	"self encapsulate field": {
		what: "A class reads its own field directly, so a subclass cannot change how it is computed.",
		then: "Routes internal access through the getter and setter.",
	},
	"replace data value with object": {
		what: "A primitive field has grown rules — validation, formatting, comparison — that live in its callers.",
		then: "Turns the field into a class that carries those rules; the cure for Primitive Obsession.",
	},
	"replace array with object": {
		what: "An array's slots mean different things — [0] is the name, [1] is the count.",
		then: "Replaces it with an object whose fields are named.",
	},
	"change unidirectional association to bidirectional": {
		what: "Two classes need each other, but only one holds the reference.",
		then: "Adds the back-reference and one owner responsible for keeping both ends consistent.",
	},
	"change bidirectional association to unidirectional": {
		what: "One direction of a two-way link is unused and keeps the classes coupled.",
		then: "Drops it, so only the side that needs the reference has it.",
	},
	"encapsulate field": {
		what: "A public field lets any caller change state without the class noticing.",
		then: "Makes it private behind an accessor, so the rules have somewhere to live.",
	},
	"encapsulate collection": {
		what: "A getter hands out the collection itself, so callers can add and remove behind the owner's back.",
		then: "Returns a read-only view and adds explicit add/remove methods.",
	},
	"replace magic number with symbolic constant": {
		what: "A literal with meaning appears in the code, sometimes in more than one place.",
		then: "Names it as a constant, so the meaning and the value have one home.",
	},
	"replace type code with class": {
		what: "An int or string type code carries meaning the compiler cannot check.",
		then: "Replaces it with a class, so only valid values exist.",
	},
	"replace type code with subclasses": {
		what: "A type code that never changes after construction drives conditionals on behaviour.",
		then: "Gives each code a subclass, so the conditionals become dispatch.",
	},
	"replace type code with state/strategy": {
		what: "The same, but the code changes during the object's life, so subclassing will not do.",
		then: "Extracts a state or strategy object the owner swaps at runtime.",
	},
	"replace subclass with fields": {
		what: "Subclasses differ only in constant values returned by their methods.",
		then: "Collapses them into fields on one class.",
	},
	"consolidate conditional expression": {
		what: "Several conditions in a row lead to the same result.",
		then: "Merges them into one expression, usually extracted into a named method.",
	},
	"consolidate duplicate conditional fragments": {
		what: "The same statement appears in every branch of a conditional.",
		then: "Moves it outside the conditional.",
	},
	"decompose conditional": {
		what: "A conditional's test and branches are complex enough that the intent is buried.",
		then: "Extracts the condition and each branch into named methods.",
	},
	"replace conditional with polymorphism": {
		what: "A conditional picks behaviour by an object's type, repeated wherever the type matters.",
		then: "Moves each branch into an overriding method, leaving one dispatch.",
	},
	"remove control flag": {
		what: "A boolean exists only to break out of a loop or skip the rest of a method.",
		then: "Replaces it with break, continue or return.",
	},
	"replace nested conditional with guard clauses": {
		what: "The normal path is buried inside nested ifs handling special cases.",
		then: "Returns early on each special case, leaving the main path unindented.",
	},
	"introduce null object": {
		what: "The same null check is repeated everywhere an optional collaborator is used.",
		then: "Supplies an object with do-nothing behaviour, so the checks disappear.",
	},
	"introduce assertion": {
		what: "A section only works under an assumption stated nowhere.",
		then: "Makes the assumption an assertion, so a violation fails loudly instead of silently.",
	},
	"add parameter": {
		what: "A method needs information its caller has and its signature does not carry.",
		then: "Adds the parameter — and note that a long list is its own smell, so prefer an object once there are several.",
	},
	"remove parameter": {
		what: "A parameter is no longer used by the body.",
		then: "Removes it from the signature and every call site.",
	},
	"rename method": {
		what: "The name does not say what the method does, so callers have to read the body.",
		then: "Renames it to what it actually does — the cheapest refactoring there is.",
	},
	"separate query from modifier": {
		what: "A method returns a value and changes state, so it cannot be called just to ask.",
		then: "Splits it into a query and a command.",
	},
	"parameterize method": {
		what: "Several methods do the same thing with different constant values.",
		then: "Merges them into one method that takes the value as a parameter.",
	},
	"introduce parameter object": {
		what: "The same group of parameters travels together through several signatures.",
		then: "Replaces the group with one object — the cure for Data Clumps and Long Parameter List.",
	},
	"preserve whole object": {
		what: "A caller pulls several values out of an object only to pass them all in.",
		then: "Passes the object instead.",
	},
	"remove setting method": {
		what: "A field is set after construction although it should never change.",
		then: "Deletes the setter and sets the field in the constructor.",
	},
	"replace parameter with explicit methods": {
		what: "A parameter chooses between a small fixed set of behaviours, usually a boolean flag.",
		then: "Gives each behaviour its own named method, so the call site reads as what it does.",
	},
	"replace parameter with method call": {
		what: "A caller computes a value and passes it in, but the callee could obtain it itself.",
		then: "Drops the parameter and calls for the value inside.",
	},
	"hide method": {
		what: "A method is public but used only from inside its own class.",
		then: "Makes it private, shrinking the surface anyone can depend on.",
	},
	"replace constructor with factory method": {
		what: "Construction needs to do more than set fields — choose a subclass, reuse an instance, validate.",
		then: "Puts a named factory method in front of the constructor.",
	},
	"replace error code with exception": {
		what: "A method returns a sentinel that callers must remember to check, and mostly do not.",
		then: "Throws instead, so an unhandled failure cannot be mistaken for a result.",
	},
	"replace exception with test": {
		what: "An exception is used for a condition the caller could simply check first.",
		then: "Replaces the throw with a test — exceptions are for the exceptional, not for control flow.",
	},
	"pull up field": {
		what: "Subclasses declare the same field.",
		then: "Moves it to the superclass.",
	},
	"pull up method": {
		what: "Subclasses have methods with identical bodies.",
		then: "Moves one to the superclass and deletes the copies.",
	},
	"pull up constructor body": {
		what: "Subclass constructors start with the same initialisation.",
		then: "Moves the common part to a superclass constructor the subclasses call.",
	},
	"push down field": {
		what: "A superclass field is used by only some subclasses.",
		then: "Moves it down to the ones that use it.",
	},
	"push down method": {
		what: "A superclass method is relevant to only some subclasses.",
		then: "Moves it down, so the others stop inheriting something they refuse.",
	},
	"extract subclass": {
		what: "Features are used by only some instances of a class.",
		then: "Creates a subclass for that case and moves them there.",
	},
	"extract superclass": {
		what: "Two classes share fields and methods but no common ancestor.",
		then: "Creates one and pulls the shared members up.",
	},
	"extract interface": {
		what: "Several clients use the same subset of a class, or two classes share part of their surface.",
		then: "Names that subset as an interface, so callers depend on it rather than the class.",
	},
	"collapse hierarchy": {
		what: "A subclass is nearly identical to its superclass.",
		then: "Merges them into one class — often what Speculative Generality needs.",
	},
	"form template method": {
		what: "Subclasses run the same sequence of steps with different implementations of some of them.",
		then: "Puts the sequence in the superclass and leaves the varying steps overridable.",
	},
	"replace inheritance with delegation": {
		what: "A subclass uses only part of what it inherits, or the relationship was never is-a.",
		then: "Holds the former superclass as a field and forwards what is actually needed.",
	},
	"replace delegation with inheritance": {
		what: "A class delegates nearly everything to one object, with a forwarding method for each.",
		then: "Makes it a subclass instead and deletes the forwarding.",
	},
};

const HEADINGS_BY_KIND: Record<ReviewTag["kind"], ReviewTagDescriptionHeadings> = {
	smell: { what: "Symptom", then: "Fix" },
	refactoring: { what: "Use when", then: "What it does" },
	builtin: { what: "Means", then: "Check" },
	// A rules-bundle category that matches a builtin label borrows its description, so it
	// borrows the builtin's headings too.
	"rule-category": { what: "Means", then: "Check" },
};

/** The tooltip headings for a tag's kind. */
export function reviewTagDescriptionHeadings(tag: ReviewTag): ReviewTagDescriptionHeadings {
	return HEADINGS_BY_KIND[tag.kind];
}

/**
 * The description a chip shows on hover, or null for a rules-bundle category nobody has
 * written one for. `Tooltip` renders its children unwrapped when the content is falsy,
 * so a null needs no branch at the call site.
 */
export function reviewTagDescription(tag: ReviewTag): ReviewTagDescription | null {
	return REVIEW_TAG_DESCRIPTIONS[tag.label.toLowerCase()] ?? null;
}

/** Every label a description exists for — the test asserts this against the catalogs. */
export function describedTagLabelKeys(): string[] {
	return Object.keys(REVIEW_TAG_DESCRIPTIONS);
}
