// Default text of the staff code of conduct (員工行為守則暨保密同意書), written for Parsley Italian Handmade Desserts.
// It is saved as a draft on first start; the manager reviews it in the dashboard (Team → Staff agreement) and publishes it.
// Format: "## " headings, "1. " numbered items, "- " bullets (indent them under a numbered item), blank lines between paragraphs, **bold**.

export const DEFAULT_AGREEMENT_VERSION = 2; // bump when the built-in text changes
// Start of the earlier built-in text, so an untouched old draft can be replaced by the new one
export const OLD_DEFAULT_START = 'Welcome to the {company} team! We are a small shop with big standards.';

export const DEFAULT_AGREEMENT = {
  title_en: 'Staff Code of Conduct & Confidentiality Agreement',
  title_zh: '員工行為守則暨保密同意書',
  body_zh: `親愛的夥伴：

歡迎加入 Parsley 團隊！

我們相信，美好的甜點來自好的原料、用心的製作，以及一群願意互相支持的人。

在 Parsley，我們不要求每個人都完美。我們知道錯誤會發生，學習需要時間，而每個人都有成長的空間。

我們希望你在這裡不只是一位員工，更是團隊的一份子。

我們重視誠實、尊重、責任感與合作精神。以下守則是為了讓每個人都能在安全、公平、愉快的環境中工作，也讓我們共同努力建立的品牌與品質得到保護。

請仔細閱讀以下內容。如有任何不清楚的地方，隨時向主管詢問。

歡迎加入我們，一起做好每一份甜點！

## 01. 誠實與責任
我們相信，信任是團隊合作的基礎。

1. 上下班打卡必須由本人操作，不得代替其他員工打卡，也不得要求他人代為打卡。
2. 必須誠實處理現金、訂單、庫存、原料及公司物品。不得私自拿取、挪用或隱瞞任何款項或物品。
3. 如果發生錯誤，例如製作失誤、訂單錯誤、商品損壞、原料浪費或金額不符，請立即向主管報告。
4. 未經主管同意，不得將任何商品、原料、工具、包材或公司財物帶離工作場所，即使是剩餘或即將丟棄的物品也一樣。
5. 不得偽造工作紀錄、庫存紀錄、訂單資料或其他公司文件。

## 02. 合作與尊重
我們是一個團隊，不是彼此競爭的對手。

1. 尊重每一位同事，不論職位、年齡、經驗或工作內容。
2. 工作忙碌時互相協助，不得故意忽視同事的合理工作需求。
3. 禁止霸凌、騷擾、歧視、威脅、羞辱或任何使他人感到不安全的行為。
4. 不得散播惡意謠言、故意製造衝突或破壞團隊合作。
5. 每次工作結束後，必須清潔並整理自己的工作區域、工具及設備。
6. 使用完公共設備及空間後，應恢復整潔，讓下一位同事可以正常使用。

## 03. 溝通與出勤
良好的溝通可以避免許多不必要的問題。

1. 如有遲到、無法上班或突發狀況，請盡早通知主管，不要等到上班時間才告知。
2. 請假必須依照公司規定，透過指定的請假系統或 App 提出申請，並依相關規定完成通知程序。
3. 不得未經通知或未經核准而自行缺勤，但依法得請假或有緊急情況者，應依相關規定處理。
4. 如果工作中遇到困難、不確定如何操作，或發現可能影響品質、安全及生產的問題，請主動提出。
5. 主管與員工之間應保持開放溝通。如有意見、建議或工作上的疑慮，可以直接提出。

## 04. 配方、製作技術與營業秘密
我們的配方與製作技術，是 Parsley 多年努力累積的重要資產。

**本條款特別重要，請務必仔細閱讀。**

1. 公司提供或員工於工作中接觸、學習或取得的配方、比例、製作程序、技術、操作方法、供應商資訊、成本資料及其他非公開營業資訊，均應受到保護。
2. 未經公司事前書面同意，不得：
  - 拍攝或錄影公司配方、製作流程及內部文件。
  - 複製、下載、抄寫或帶走配方及相關資料。
  - 將配方、製作技術或營業資訊提供給第三人。
  - 在私人社群媒體、網站、論壇或其他平台公開相關資訊。
  - 將公司機密資料輸入 ChatGPT、Gemini、Claude 或其他 AI 工具。
  - 使用個人手機、電腦、雲端硬碟或私人帳號儲存公司機密資料。
3. 公司資料僅能用於經授權的工作目的，不得用於個人營利、私人接案或其他未經許可的用途。
4. 離職時，員工必須歸還所有公司文件、配方、紀錄、設備及其他資料，並停止使用任何公司機密資訊。
5. 保密義務不因離職、解僱或勞動契約終止而消失。對於依法構成營業秘密的資訊，保密義務持續至該資訊不再具備營業秘密的法律要件為止。其他依法應保密的資訊，則依相關法律及約定處理。
6. 本條款依台灣《營業秘密法》及其他相關法律訂定。員工理解，符合營業秘密法定要件的資訊，可能受到法律保護。
7. 如員工發現配方、資料或其他機密資訊遭到未經授權的使用、外洩或存取，應立即通知主管。

## 05. 衛生與食品安全
我們對食品品質與顧客安全負有責任。

1. 上班期間必須保持個人清潔，穿著公司規定的工作服、圍裙及必要的防護用品。
2. 製作食品前、如廁後、接觸垃圾、生食、清潔用品或其他可能造成污染的物品後，必須正確洗手。
3. 工作時必須遵守食品安全規範，包括原料保存、溫度控制、交叉污染預防、清潔及消毒程序。
4. 不得使用已過期、變質、受污染或來源不明的原料。
5. 如有發燒、嘔吐、腹瀉、傳染性疾病或其他可能影響食品安全的症狀，必須立即通知主管。
6. 發現設備故障、蟲害、污染、異物或食品安全疑慮時，應立即停止相關作業並通知主管。
7. 未經授權，不得自行更改配方、原料、保存方式、標示或製作程序。
8. 必須遵守公司制定的清潔、消毒及食品安全作業程序。

## 06. 工作場所行為
專業不只是技術，也包括工作態度。

1. 上班期間應專注於工作，不得長時間處理私人事務或從事與工作無關的活動。
2. 未經主管同意，不得在工作時間長時間使用私人手機、觀看影片或玩遊戲。
3. 工作場所禁止飲酒、吸毒或在受酒精及其他影響工作安全的物質作用下工作。
4. 未經許可，不得帶親友或其他非工作人員進入生產及工作區域。
5. 必須正確使用設備、工具及機器，不得故意損壞或不當操作。
6. 不得在工作場所從事違法、危險或影響公司正常營運的行為。
7. 應遵守主管合理且合法的工作指示。

## 07. 社群媒體與對外發言
我們每個人的行為，都可能影響 Parsley 的品牌形象。

1. 未經公司同意，不得以公司名義發布聲明、承諾、促銷活動或對外公告。
2. 不得公開公司內部資訊、配方、製作流程、成本、客戶資料、員工個人資料或其他機密資訊。
3. 未經同意，不得拍攝或發布工作場所、內部文件、同事或生產過程的照片及影片，尤其不得洩露機密資訊。
4. 不得在社群媒體上發布故意捏造、惡意或具有誤導性的內容，冒用公司名義或損害他人權益。
5. 如遇到顧客投訴、媒體詢問或其他需要代表公司回應的情況，請交由主管處理。
6. 員工依法享有個人言論自由及其他合法權益。本條款不限制依法受保障的言論、申訴、檢舉或勞動權益。

## 08. 違反規定的處理方式
我們希望問題能透過溝通與改善來解決，但每個人也必須為自己的行為負責。

1. 如發現違反本守則的情況，公司會依事件性質、嚴重程度、發生原因及相關事實進行了解。
2. 對於一般或輕微違規，公司原則上採取以下處理方式：
  - 第一次：主管與員工溝通，說明問題並要求改善。
  - 再次發生：視情況給予書面警告，並說明需要改善的事項。
  - 持續發生：依違規情況及相關法律規定進一步處理。
3. 對於重大違規，例如偷竊、故意偽造紀錄、嚴重違反食品安全規定、霸凌、騷擾、故意破壞公司財物或洩漏營業秘密，公司得依法律及具體情況採取適當處理。
4. 如員工的行為符合《勞動基準法》第12條所列法定事由，公司得依法終止勞動契約，無須預告。但必須符合相關法律要件及法定期限。
5. 公司會依據客觀事實處理事件，並給予員工適當說明及陳述意見的機會。
6. 不論任何情況，公司都不會以本守則作為違法扣薪、任意罰款或剝奪員工法定權益的依據。

## 09. 我們對你的承諾
這份守則不只是員工的責任，也是 Parsley 對團隊的承諾。

我們承諾：

1. 公平對待每一位員工，不因個人背景、年齡、性別或其他因素而有不合理的差別待遇。
2. 依照勞動契約及相關法律，準時支付薪資及應有的報酬。
3. 提供必要的工作訓練、指導及合理的工作支持。
4. 尊重每一位員工的隱私，妥善保護個人資料。
5. 建立安全、衛生、尊重且沒有霸凌與騷擾的工作環境。
6. 願意聆聽員工的意見、建議及合理的工作需求。
7. 鼓勵員工學習、進步，並在工作中發展自己的能力。

## 員工閱讀與簽署確認
本人確認：

1. 已閱讀並理解本《員工行為守則暨保密同意書》的全部內容。
2. 有機會就不清楚的條款向公司詢問，並已理解相關規定。
3. 同意在任職期間遵守本守則及公司合法、合理的工作規定。
4. 理解並同意妥善保護公司依法應保密的配方、技術及營業秘密。
5. 理解保密義務在勞動關係終止後，仍依本文件及相關法律繼續有效。
6. 理解本文件不取代勞動契約，也不限制本人依法享有的任何勞動權益。`,
  body_en: `Welcome to the team!

We believe great desserts come from good ingredients, careful craftsmanship, and people who support one another.

At Parsley, we don't expect anyone to be perfect. Mistakes happen, learning takes time, and everyone deserves the opportunity to grow.

We hope you will feel that you are not simply an employee, but an important part of our team.

We value honesty, respect, responsibility, and cooperation. These guidelines are here to help everyone work in a safe, fair, and positive environment, while protecting the quality, knowledge, and brand we are building together.

Please read the following carefully. If anything is unclear, you are always welcome to ask your manager.

Welcome aboard. Let's make something wonderful together!

## 01. Honesty & Responsibility
Honesty is the foundation of trust.

1. Employees must clock in and out personally. Clocking in or out on behalf of another employee, or asking someone else to do so, is prohibited.
2. Handle cash, orders, inventory, ingredients, and company property honestly. Taking, using, or concealing company money or property without authorization is prohibited.
3. Report mistakes to your manager immediately, including production errors, incorrect orders, damaged products, wasted ingredients, or cash discrepancies.
4. Nothing may be taken out of the workplace without management approval, including products, ingredients, tools, packaging, or company property, even if they are leftover or intended for disposal.
5. Falsifying attendance records, inventory records, order information, or other company documents is prohibited.

## 02. Cooperation & Respect
We are a team, not competitors.

1. Treat every colleague with respect, regardless of position, age, experience, or responsibilities.
2. Support one another during busy periods. Do not deliberately ignore reasonable requests for assistance.
3. Bullying, harassment, discrimination, threats, humiliation, or any behavior that makes others feel unsafe is prohibited.
4. Do not spread malicious rumors, deliberately create conflict, or undermine teamwork.
5. Clean and organize your workstation, tools, and equipment after completing your work.
6. Leave shared equipment and spaces clean and ready for the next person.

## 03. Communication & Attendance
Good communication prevents unnecessary problems.

1. If you will be late, unable to attend work, or facing an unexpected situation, inform your manager as early as possible. Do not wait until your scheduled starting time.
2. Leave requests must be submitted through the designated company leave system or app and follow the applicable notification procedures.
3. Do not be absent without notifying the company or following the required procedures. Statutory leave and genuine emergencies will be handled in accordance with applicable law.
4. If you encounter difficulties, are unsure how to perform a task, or notice a potential problem affecting quality, safety, or production, speak up.
5. We encourage open communication between managers and employees. Questions, suggestions, and workplace concerns are always welcome.

## 04. Recipes, Production Methods & Trade Secrets
Our recipes and production methods are valuable assets built through years of hard work.

**This section is particularly important. Please read it carefully.**

1. Recipes, ingredient ratios, production procedures, techniques, operating methods, supplier information, costing information, and other non-public business information provided by or accessed, learned, or obtained through employment must be protected.
2. Without prior written authorization from the company, employees must not:
  - Photograph or record company recipes, production processes, or internal documents.
  - Copy, download, transcribe, or remove recipes or related materials.
  - Share recipes, production techniques, or business information with third parties.
  - Publish such information on personal social media, websites, forums, or other platforms.
  - Enter confidential company information into ChatGPT, Gemini, Claude, or other AI tools.
  - Store confidential company information on personal phones, computers, cloud drives, or private accounts.
3. Company information may only be used for authorized work purposes. It must not be used for personal profit, private business, or any unauthorized purpose.
4. Upon leaving the company, employees must return all company documents, recipes, records, equipment, and other materials, and stop using confidential company information.
5. Confidentiality obligations do not end when employment ends. For information that legally qualifies as a trade secret, the obligation continues for as long as the information meets the legal requirements for trade secret protection. Other confidential information remains protected as required by applicable laws and agreements.
6. This section is established with reference to Taiwan's Trade Secrets Act and other applicable laws. Employees acknowledge that information meeting the legal requirements may receive legal protection.
7. If you discover any unauthorized use, disclosure, or access involving recipes, records, or other confidential information, notify your manager immediately.

## 05. Hygiene & Food Safety
We are responsible for the quality of our food and the safety of our customers.

1. Maintain personal hygiene and wear the required company uniform, apron, and protective equipment.
2. Wash your hands properly before handling food, after using the restroom, and after handling waste, raw ingredients, cleaning products, or anything that may cause contamination.
3. Follow all food safety procedures, including ingredient storage, temperature control, cross-contamination prevention, cleaning, and sanitation.
4. Never use expired, spoiled, contaminated, or unidentified ingredients.
5. If you experience fever, vomiting, diarrhea, an infectious illness, or any other condition that may affect food safety, inform your manager immediately.
6. If you notice equipment failure, pests, contamination, foreign objects, or any food safety concern, stop the affected operation and notify your manager immediately.
7. Do not change recipes, ingredients, storage methods, labels, or production procedures without authorization.
8. Follow all company cleaning, sanitation, and food safety procedures.

## 06. Professional Conduct at Work
Professionalism is not only about skill. It is also about attitude.

1. Stay focused on your responsibilities during working hours. Avoid spending excessive time on personal matters or activities unrelated to work.
2. Do not use personal phones for extended periods, watch videos, or play games during working hours without management approval.
3. Alcohol and illegal drugs are prohibited in the workplace. Employees must never work under the influence of alcohol or any substance that compromises workplace safety.
4. Do not bring friends, family members, or other unauthorized visitors into production or work areas.
5. Use all equipment, tools, and machinery properly. Deliberate damage or misuse is prohibited.
6. Do not engage in illegal, dangerous, or disruptive activities at the workplace.
7. Follow reasonable and lawful work instructions from your manager.

## 07. Social Media & Public Communication
Our individual actions can affect the Parsley brand.

1. Do not make statements, promises, promotional announcements, or public announcements on behalf of the company without authorization.
2. Do not disclose internal company information, recipes, production methods, costs, customer information, employee personal information, or other confidential information.
3. Do not photograph or publish images or videos of the workplace, internal documents, colleagues, or production activities without authorization, especially where confidential information may be revealed.
4. Do not deliberately publish fabricated, malicious, or misleading content using the company's identity or in a way that infringes on the rights of others.
5. Refer customer complaints, media inquiries, or other requests requiring an official company response to your manager.
6. Employees retain their lawful rights to freedom of expression, complaints, reporting, and protection of labor rights. Nothing in this section is intended to restrict rights protected by law.

## 08. Handling Violations of Company Rules
We prefer to resolve problems through communication and improvement, but everyone must also take responsibility for their actions.

1. When a violation is reported or discovered, the company will review the circumstances, seriousness, reasons, and relevant facts.
2. For ordinary or minor violations, the company will generally follow this process:
  - First occurrence: A conversation with the manager to explain the issue and request improvement.
  - Repeated occurrence: A written warning may be issued, explaining the required improvements.
  - Continued violations: Further action may be taken according to the circumstances and applicable laws.
3. For serious violations, including theft, deliberate falsification of records, serious food safety violations, bullying, harassment, deliberate damage to company property, or disclosure of trade secrets, the company may take appropriate action in accordance with applicable laws and the circumstances.
4. If an employee's conduct meets the statutory grounds under Article 12 of Taiwan's Labour Standards Act, the company may terminate the employment contract without advance notice, provided all applicable legal requirements and deadlines are satisfied.
5. The company will assess incidents based on objective facts and provide employees with an appropriate opportunity to explain their actions and present their views.
6. Under no circumstances will this agreement be used as a basis for unlawful wage deductions, arbitrary fines, or the denial of employees' statutory rights.

## 09. Our Promise to You
This agreement is not only about employee responsibilities. It is also about Parsley's commitment to its team.

We promise to:

1. Treat every employee fairly and avoid unreasonable discrimination based on personal background, age, gender, or other factors.
2. Pay salaries and other compensation on time in accordance with employment agreements and applicable laws.
3. Provide necessary job training, guidance, and reasonable workplace support.
4. Respect every employee's privacy and protect personal information appropriately.
5. Maintain a safe, hygienic, respectful workplace free from bullying and harassment.
6. Listen to employees' opinions, suggestions, and reasonable workplace needs.
7. Encourage employees to learn, improve, and develop their abilities.

## Employee Acknowledgment & Agreement
I acknowledge that:

1. I have read and understood the entire Staff Code of Conduct & Confidentiality Agreement.
2. I have had the opportunity to ask questions about any unclear provisions and understand the relevant requirements.
3. I agree to follow these guidelines and the company's lawful and reasonable workplace rules during my employment.
4. I understand and agree to protect the company's legally confidential recipes, techniques, and trade secrets.
5. I understand that confidentiality obligations continue after the end of employment as provided in this agreement and applicable laws.
6. I understand that this document does not replace my employment contract or limit any labor rights protected by law.`,
};
