# Chapter 11. What is a company allowed to know about you?

## A father walks into a store

A father walks into Target, angry about the baby-product coupons sent to his teenage daughter. Is the store encouraging her to become pregnant? The manager apologises. Later, according to the story, the father apologises too: there were developments at home he had not known about.

Charles Duhigg told that story in his February 2012 New York Times Magazine article, “How Companies Learn Your Secrets.” His account described work by Target statistician Andrew Pole to identify possible pregnancies from purchasing patterns. A baby registry supplied examples of customers whose circumstances were known; other purchase histories could be compared with those examples. The commercial reasoning was straightforward: a change in someone's life might be an opportunity to change where they shop. [Duhigg's original reporting](https://www.nytimes.com/2012/02/19/magazine/shopping-habits.html).

The father story is memorable because the retailer appears to know something before the family does. It is also a story we need to handle carefully.

This is a different Target episode from the breach in Chapter 10. There, outsiders gained access to information. Here, the question is what a business should do with information already inside its own systems. A company can protect its records from intruders and still use them in ways its customers find unacceptable.

## Ask the three questions about the story itself

Before we draw any lessons, do to that anecdote what Chapter 6 taught you to do to a number. Ask where it came from, what it establishes and what has been added in the telling.

Duhigg attributed the anecdote to an unnamed Target employee who participated in the conversation. The family is unidentified. The anecdote does not supply a record we can inspect linking a particular model prediction to a particular mailing. A coupon could reach somebody through a broad promotion, a shared household account or an ordinary marketing segment. Its arrival alone would not establish that an accurate pregnancy prediction had been made.

Treat the anecdote as a reported, disputed illustration, not a documented demonstration of the model's accuracy. That does not establish that the story is false. It establishes a limit on what we can conclude from it.

That distinction matters in a business meeting. “A retailer reportedly used purchase patterns to estimate pregnancy” is one claim. “This model identified this teenager before her father knew” is a stronger one. A memorable story can carry the second claim farther than the available evidence does.

The privacy problem remains worth examining even if we cannot settle this particular story. A company does not have to infer correctly every time for its use of an inference to affect somebody's life.

## Inference is the whole subject

Here is the idea to carry out of this chapter.

The privacy question is not only what you collect. It is what you can work out, and what you then decide to do.

A transaction records a purchase. A model may turn a pattern of purchases into an estimate about a person's circumstances. A marketing system may turn that estimate into a message. Those are three different steps, and a manager is responsible for more than the accuracy of the middle one.

The following examples are illustrative possibilities, not claims that a particular organisation uses these exact rules.

| Recorded data | Possible inference | Proposed action |
|---|---|---|
| Purchase pattern | Possible pregnancy | Baby-product offer |
| Location history | Possible clinic visit | Targeted advertisement |
| Unusual card activity | Possible fraud | Transaction review |

*Figure 11.1 — Collected, inferred, used. The ethical and legal questions change when a recorded event becomes an estimate and then an action. An inference may be wrong; assess purpose, permission and harm.*

Notice the word “possible.” A location near a clinic could belong to an employee, a patient, a delivery driver or somebody visiting the building next door. A transaction that looks unusual could be fraud or a legitimate purchase on holiday. A pattern is evidence to interpret, not a confession.

Now notice the last column. Reviewing a payment and advertising a suspected health condition create different consequences. Even a correct inference can reveal something a person wanted to keep private. An incorrect one can put somebody in a category they cannot see or challenge.

So when somebody in your career says “we're not collecting anything sensitive,” the useful reply is a question: what can be derived from what we collect, and would the customer regard that derivation as ours to make?

Do not assume that an inference sits outside privacy rules because nobody typed it into a form. Equally, do not assume every inference requires the same permission. The data, purpose, affected people and applicable law all matter. A checkbox is the beginning of that enquiry, not its conclusion.

## The same mechanism, at a much larger scale

Chapter 1 left Facebook in a Senate hearing room in April 2018. Cambridge Analytica brings that discussion back to the design of an information system.

On April 4, Facebook estimated that information about up to 87 million people may have been improperly shared with Cambridge Analytica. Keep the wording: an estimate of possible exposure, not a count of voters whose behaviour was changed. [Facebook's April 2018 announcement](https://about.fb.com/news/2018/04/restricting-data-access/).

The controversy involved an app and access to information about its users' friends. One person's interaction with a service could therefore have consequences for other people. The FTC later alleged that Facebook misled users about sharing friends' data with app developers, including when those friends had selected restrictive privacy settings.

In July 2019, the FTC announced a $5 billion settlement with Facebook over alleged violations of its 2012 privacy order. Its action addressed broader privacy practices and oversight failures; it was not simply a fine for Cambridge Analytica's targeting. [FTC settlement announcement](https://www.ftc.gov/news-events/news/press-releases/2019/07/ftc-imposes-5-billion-penalty-sweeping-new-privacy-restrictions-facebook).

Cambridge Analytica promoted psychological profiling for political targeting. The UK Information Commissioner’s Office (ICO) later reported that some staff questioned leadership’s claims about impact and influence. These records do not establish that the company changed an election outcome. We should not convert a claim to predict people into proof that people were successfully manipulated. [Company announcement](https://www.prnewswire.com/news-releases/alexander-nix-to-present-on-big-data-and-psychographics-at-2016-concordia-summit-300326587.html); [ICO closing letter, paragraph 5](https://committees.parliament.uk/publications/2848/documents/27737/default/).

Two managerial problems remain distinct. Who was allowed to obtain the information? What uses could they make of it after obtaining it? The second question does not disappear when a supplier signs a contract. Somebody must decide what access is necessary, check what the supplier actually does and have a way to stop an unacceptable use.

The business lesson reaches beyond social media. When a feature draws on information about a household, a work team or a group of friends, ask whose interests are affected besides the person pressing the button.

## Regulation as a design constraint

Most business students meet privacy law as a compliance topic, which makes it easy to delegate. Meet it instead as a constraint on what your systems can be.

Under Europe's General Data Protection Regulation, personal-data processing needs a lawful basis; consent is one possible basis, not the only one. People have rights including access, correction and erasure, subject to conditions and exceptions. A deletion request does not automatically override a legal obligation to retain a record. These are scoped rights, not a promise that every copy of every record disappears on demand. [GDPR, Articles 6 and 15–17](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).

The practical consequence is a design question. If your organisation must correct a person's information, can it find the relevant records? Chapter 6's customer identifiers now matter for a different reason. If two records refer to the same person, correcting one while continuing to use the other may leave the problem intact.

California's privacy law provides covered consumers with rights that include knowing about personal information, requesting correction or deletion, and opting out of its sale or sharing. Coverage and exceptions matter; the law does not apply identically to every organisation or every record. [California Attorney General's explanation](https://oag.ca.gov/privacy/ccpa).

Sector rules also have boundaries. In American healthcare, HIPAA's Privacy Rule applies to specified covered entities and their business associates. It is not a universal rule for every app or employer holding health-related information. Being outside HIPAA does not establish that no other privacy obligation applies. [HHS summary](https://www.hhs.gov/hipaa/for-professionals/privacy/laws-regulations/index.html).

You do not need to memorise a catalogue of laws to recognise the managerial task. Before approving a feature, identify the relevant jurisdiction and get the necessary specialist advice. Then turn that advice into a purpose the team understands, permissions the system enforces and a process somebody owns.

A signature can record an approval. It cannot make an unworkable process comply. The business manager must be able to explain what has been authorised and how the organisation will carry it out.

## From discomfort to a decision

Consider a fictional retailer, Harbour Home. Its marketing team proposes using shopping histories to label some customers “likely new parents” and send them personalised offers. The label would appear in the customer record used by service staff. A marketing vendor would receive the list for email delivery.

Suppose Sam buys baby supplies for a relative. The purchases are recorded correctly, but the model assigns the new-parent label to Sam. The email is irrelevant. More seriously, a service employee might treat the label as something Sam has disclosed, or the vendor might keep it for another campaign.

The manager should separate three questions. Is the proposed processing legally permitted in this setting? Is it useful enough to justify its costs and errors? Is it acceptable in the relationship the company has with its customers? A favourable answer to one does not settle the other two.

Start with the purpose. “Improve marketing” gives almost anything a place to hide. “Offer customers baby-product promotions they have chosen to receive” describes a narrower service. That purpose suggests another design: let customers select product interests without assigning a life-stage label to them.

This alternative has a commercial cost. Some customers will never select an interest, so the audience could be smaller. It also changes what the retailer needs to know. A customer can want baby-product offers without being a parent. The manager must compare the value of reaching additional people with the consequences of guessing about them.

Put some hypothetical money beside the proposal. Suppose the team forecasts 400 additional orders compared with customer-selected offers, each contributing $12 after product and fulfilment costs. That is $4,800 of additional contribution, not $4,800 of profit. Suppose the extra campaign and review work would cost $3,000. The remaining forecast benefit is $1,800 before costs the team has not estimated, including handling complaints or correcting labels.

Those numbers do not price away the privacy question. They show how little room the proposal may have once somebody asks what “more sales” actually means. The forecast also needs evidence: would those 400 orders really be additional, or would the customers have bought anyway? The manager can request evidence supporting the estimate without authorising the proposed use of personal information.

If the team cannot demonstrate the additional value, there is less reason to accept the more intrusive design. If it can, the permission and acceptability questions still remain. A financial case is part of the decision, not a substitute for the other parts.

Next, decide who needs access. An email provider may need a delivery address and the selected offer. It does not automatically need the full shopping history or an explanation of a suspected pregnancy. Service staff may need to change a marketing preference without seeing a sensitive label. Access follows the job to be done.

Then set a retention rule: how long the information is kept and what ends its use. For this hypothetical campaign, the manager could require the vendor to remove its working list when the campaign and agreed reporting are complete. Required transaction records would follow their own retention rules. “Delete the campaign list” and “delete the customer's purchase history” are different instructions.

The campaign owner must confirm the vendor can follow that rule and provide evidence of completion. Moving information to a supplier changes the work required to control it; it does not finish the work.

Now imagine Sam asks why the offer arrived and says the label is wrong. The service process needs a route to find the campaign decision, correct or remove the label as appropriate and stop its continued use. Simply changing the name or email address misses the complaint. Simply removing the label also fails if tomorrow's automatic run recreates it from the same purchases.

This is where people, process, data and technology meet. A service employee receives the request. A campaign owner decides the operational response with privacy advice where needed. Linked records identify where the label went. The system must carry the decision into future campaigns, including those handled by the vendor.

In this example, one defensible approval would allow customer-selected offers, prohibit the inferred life-stage label, restrict the vendor's use and require a working preference-change process before launch. Another proposal might justify a different design. What would not be adequate is “the model works, so proceed.”

The manager should also decide what evidence would cause the approval to be revisited. More sales alone would not reveal whether people were embarrassed, incorrectly labelled or unable to stop messages. Complaints, unsuccessful preference changes and vendor exceptions belong beside campaign results. The organisation needs a way to notice when the promised controls are failing.

## The hard version, which has no tidy answer

The uncomfortable part is that the interests genuinely conflict.

Inference is not a bug. Consider the possible value of spotting an unusual payment before a loss, or anticipating demand before a shelf is empty. Refusing all analysis would discard useful decisions along with objectionable ones. But describing a feature as useful does not decide how much information it should use or who should bear its mistakes.

A fraud warning makes the trade-off visible. Reviewing a suspicious transaction may protect the customer. Blocking a legitimate one can leave that same customer unable to pay. The response could ask for confirmation, route the case for review or decline the payment. Which response is proportionate depends on the evidence, the possible loss and the person's ability to resolve the problem. This is an illustrative decision, not a universal banking procedure.

A working test, cruder than an ethics framework and useful as a starting point: would you be comfortable explaining this to the customer in a sentence? Not in a privacy policy — in a sentence, to their face.

“We guessed you were pregnant and sent that guess to our marketing provider” is awkward. The awkwardness is a signal to examine the design. It is not, by itself, a legal finding.

Nor is a comfortable explanation enough. People may understand a practice and still have little practical choice about accepting it. An employee depends on a job; a customer may depend on an essential service. Ask what happens if the person refuses, objects or needs a correction. A choice that cannot be exercised without a serious penalty deserves closer scrutiny.

Finally, consider who can see the consequence. An unwanted email is visible. An unseen category affecting which offers appear may be much harder to notice. A company should not take a lack of complaints as proof that customers accept a use they cannot discover.

## Naming it

Personal data concerns an identified or identifiable person. Removing a name does not necessarily prevent identification if other fields can reconnect the record to someone.

Inferred data is what you derive rather than directly observe or receive. Keep that distinction visible when people use it: an estimated circumstance should not quietly become a confirmed fact.

Purpose limitation means keeping use tied to specified purposes and examining whether a proposed further use is permitted. In managerial terms, a dataset built for operations is not automatically available for every marketing idea.

Data minimisation means limiting personal data to what the purpose needs. It challenges the instinct to keep everything in case it becomes useful. Retention adds a second question: for how long is it needed?

These principles sit within applicable privacy rules; their exact legal requirements depend on the setting. Their practical value is that they make a vague promise about privacy into questions an operating team can answer.

## Your turn

Use Harbour Home, or invent another organisation and a fictional customer. Write down three things it might infer without asking directly. For each, identify the recorded facts that could support the inference and one plausible reason it could be wrong. You do not need to disclose anything about your own life or inspect a real person's records.

Take the hardest of the three. Describe one proposed business action, who benefits and who could be harmed. Would a reasonable person be surprised? If the company acted on the inference, how would that person discover the reason and challenge it?

Finish with a short approval decision: permit the proposal, change it or decline it. State the permitted purpose, the access needed, when use should end and who will handle a correction. Identify any legal question that requires advice instead of guessing the answer.

The thing to retain is the movement from a recorded fact to an estimate to an action. At each step, somebody has made a choice. The manager's job is to make those choices explicit before they become somebody else's consequences.

## Sources and example notes

The [Target account](https://ibalab.pusan.ac.kr/bbs/ibalab/2409/1521193/download.do) is attributed reporting, not verified model performance; its anecdote comes from an unnamed employee. Cambridge Analytica’s promotional claims and the ICO’s findings do not establish electoral effects. The [FTC’s separate finding against Cambridge Analytica](https://www.ftc.gov/news-events/news/press-releases/2019/12/ftc-issues-opinion-order-against-cambridge-analytica-deceiving-consumers-about-collection-facebook) concerned deceptive data collection. GDPR and HIPAA references support limited introductory distinctions, not application-specific advice. Harbour Home, Sam and the campaign economics are fictional.

