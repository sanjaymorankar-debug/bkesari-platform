import { PrismaClient } from '@prisma/client'
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, ROLE_CODES } from '@community-platform/shared-types'

const prisma = new PrismaClient()

const ROLE_LABELS: Record<string, string> = {
  MEMBER: 'Member',
  KARTA: 'Family Head (Karta)',
  OPERATOR: 'Operator',
  ASSET_OWNER: 'Asset Owner',
  ADMIN: 'Administrator',
}

const RELATIONSHIP_TYPES = [
  { code: 'father', label: 'Father', inverseCode: 'son', genderApplicable: 'MALE' },
  { code: 'mother', label: 'Mother', inverseCode: 'son', genderApplicable: 'FEMALE' },
  { code: 'son', label: 'Son', inverseCode: 'father', genderApplicable: 'MALE' },
  { code: 'daughter', label: 'Daughter', inverseCode: 'father', genderApplicable: 'FEMALE' },
  { code: 'husband', label: 'Husband', inverseCode: 'wife', genderApplicable: 'MALE', isSpouse: true },
  { code: 'wife', label: 'Wife', inverseCode: 'husband', genderApplicable: 'FEMALE', isSpouse: true },
  { code: 'brother', label: 'Brother', inverseCode: 'brother', genderApplicable: 'MALE' },
  { code: 'sister', label: 'Sister', inverseCode: 'brother', genderApplicable: 'FEMALE' },
  { code: 'grandfather_p', label: 'Grandfather (Paternal)', inverseCode: 'grandson', genderApplicable: 'MALE' },
  { code: 'grandmother_p', label: 'Grandmother (Paternal)', inverseCode: 'grandson', genderApplicable: 'FEMALE' },
  { code: 'grandson', label: 'Grandson', inverseCode: 'grandfather_p', genderApplicable: 'MALE' },
  { code: 'granddaughter', label: 'Granddaughter', inverseCode: 'grandfather_p', genderApplicable: 'FEMALE' },
  { code: 'son_in_law', label: 'Son-in-law', inverseCode: 'father_in_law', genderApplicable: 'MALE' },
  { code: 'daughter_in_law', label: 'Daughter-in-law', inverseCode: 'father_in_law', genderApplicable: 'FEMALE' },
  { code: 'father_in_law', label: 'Father-in-law', inverseCode: 'son_in_law', genderApplicable: 'MALE' },
  { code: 'mother_in_law', label: 'Mother-in-law', inverseCode: 'son_in_law', genderApplicable: 'FEMALE' },
]

// docs/12-approval-workflow.md §4
const APPROVAL_RULES = [
  { actionCode: 'family.create', requiresApproval: true, approverRole: 'OPERATOR' },
  { actionCode: 'family.member.add', requiresApproval: true, approverRole: 'OPERATOR' },
  { actionCode: 'family.karta.transfer', requiresApproval: true, approverRole: 'ADMIN' },
  { actionCode: 'family.merge', requiresApproval: true, approverRole: 'ADMIN' },
  { actionCode: 'member.marital_status.change', requiresApproval: true, approverRole: 'OPERATOR' },
  { actionCode: 'member.mark_deceased', requiresApproval: true, approverRole: 'OPERATOR' },
  { actionCode: 'member.relationship.change', requiresApproval: true, approverRole: 'OPERATOR' },
  { actionCode: 'asset.register', requiresApproval: true, approverRole: 'OPERATOR' },
  { actionCode: 'asset.suspend', requiresApproval: true, approverRole: 'ADMIN' },
  { actionCode: 'offline_payment.verify', requiresApproval: true, approverRole: 'OPERATOR' },
  { actionCode: 'data.deletion_request', requiresApproval: true, approverRole: 'ADMIN' },
  { actionCode: 'member.edit_own', requiresApproval: false },
]

// docs/06-database-schema.md §E — a starter catalog; Admin can add more later
const POST_TYPES = [
  { code: 'GENERAL', label: 'General', icon: 'message-circle', requiresApproval: false },
  { code: 'ANNOUNCEMENT', label: 'Announcement', icon: 'megaphone', requiresApproval: true },
  { code: 'EVENT', label: 'Event', icon: 'calendar', requiresApproval: false },
  { code: 'HELP_REQUEST', label: 'Help Request', icon: 'life-buoy', requiresApproval: false },
  { code: 'CONDOLENCE', label: 'Condolence', icon: 'flower', requiresApproval: false },
]

// docs/06-database-schema.md §F — a starter catalog; Admin can add more later
const ASSET_CATEGORIES = [
  { code: 'MARRIAGE_HALL', label: 'Marriage Hall', sortOrder: 1 },
  { code: 'COMMUNITY_HALL', label: 'Community Hall', sortOrder: 2 },
  { code: 'GUEST_HOUSE', label: 'Guest House', sortOrder: 3 },
  { code: 'GROUND', label: 'Open Ground', sortOrder: 4 },
]

// M6 — a starter catalog; Admin can add more via /admin/config
const EDUCATION_LEVELS = [
  { code: 'BELOW_10TH', label: 'Below 10th', sortOrder: 1 },
  { code: 'SSC', label: 'SSC / 10th', sortOrder: 2 },
  { code: 'HSC', label: 'HSC / 12th', sortOrder: 3 },
  { code: 'DIPLOMA', label: 'Diploma', sortOrder: 4 },
  { code: 'GRADUATE', label: "Bachelor's Degree", sortOrder: 5 },
  { code: 'POST_GRADUATE', label: "Master's Degree", sortOrder: 6 },
  { code: 'DOCTORATE', label: 'Doctorate', sortOrder: 7 },
  { code: 'OTHER', label: 'Other', sortOrder: 8 },
]

// M6 — a starter catalog; Admin can add more via /admin/config
const OCCUPATIONS = [
  { code: 'STUDENT', label: 'Student', sortOrder: 1 },
  { code: 'SALARIED', label: 'Salaried Professional', sortOrder: 2 },
  { code: 'BUSINESS', label: 'Business Owner', sortOrder: 3 },
  { code: 'GOVERNMENT', label: 'Government Service', sortOrder: 4 },
  { code: 'FARMER', label: 'Agriculture', sortOrder: 5 },
  { code: 'HOMEMAKER', label: 'Homemaker', sortOrder: 6 },
  { code: 'RETIRED', label: 'Retired', sortOrder: 7 },
  { code: 'NOT_WORKING', label: 'Not Working', sortOrder: 8 },
  { code: 'OTHER', label: 'Other', sortOrder: 9 },
]

// M6 — a starter catalog; Admin can add more via /admin/config
const SKILLS = [
  { code: 'COOKING', label: 'Cooking' },
  { code: 'MUSIC', label: 'Music' },
  { code: 'TEACHING', label: 'Teaching' },
  { code: 'ACCOUNTING', label: 'Accounting' },
  { code: 'IT_SOFTWARE', label: 'IT / Software' },
  { code: 'HANDICRAFT', label: 'Handicraft' },
  { code: 'PUBLIC_SPEAKING', label: 'Public Speaking' },
]

async function main() {
  console.log('Seeding communities...')
  await prisma.community.upsert({
    where: { slug: 'ladwani-samaj' },
    update: {},
    create: { name: 'Ladwani Samaj', slug: 'ladwani-samaj' },
  })

  console.log('Seeding permissions...')
  const permissionRows = await Promise.all(
    PERMISSIONS.map((code) =>
      prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, label: code, module: code.split(':')[0] },
      }),
    ),
  )
  const permissionIdByCode = new Map(permissionRows.map((p) => [p.code, p.id]))

  console.log('Seeding roles and role-permission bundles...')
  for (const roleCode of ROLE_CODES) {
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: {},
      create: { code: roleCode, label: ROLE_LABELS[roleCode], isSystem: true },
    })

    const permissions = DEFAULT_ROLE_PERMISSIONS[roleCode]
    const permissionIds = permissions.map((code) => permissionIdByCode.get(code)).filter((id): id is string => !!id)

    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permissionId: { notIn: permissionIds } },
    })
    for (const permissionId of permissionIds) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      })
    }
  }

  console.log('Seeding relationship types...')
  for (const rt of RELATIONSHIP_TYPES) {
    await prisma.relationshipType.upsert({ where: { code: rt.code }, update: {}, create: rt })
  }

  console.log('Seeding approval rules...')
  for (const rule of APPROVAL_RULES) {
    await prisma.approvalRule.upsert({ where: { actionCode: rule.actionCode }, update: {}, create: rule })
  }

  console.log('Seeding post types...')
  for (const pt of POST_TYPES) {
    await prisma.postType.upsert({ where: { code: pt.code }, update: {}, create: pt })
  }

  console.log('Seeding asset categories...')
  for (const cat of ASSET_CATEGORIES) {
    await prisma.assetCategory.upsert({ where: { code: cat.code }, update: {}, create: cat })
  }

  console.log('Seeding education levels...')
  for (const lvl of EDUCATION_LEVELS) {
    await prisma.educationLevel.upsert({ where: { code: lvl.code }, update: {}, create: lvl })
  }

  console.log('Seeding occupations...')
  for (const occ of OCCUPATIONS) {
    await prisma.occupation.upsert({ where: { code: occ.code }, update: {}, create: occ })
  }

  console.log('Seeding skills...')
  for (const skill of SKILLS) {
    await prisma.skill.upsert({ where: { code: skill.code }, update: {}, create: skill })
  }

  console.log('Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
