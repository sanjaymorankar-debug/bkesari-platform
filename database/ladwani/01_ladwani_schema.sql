-- Mi Ladwani (Next.js + Prisma) database: all 44 tables + 66 foreign keys.
-- Generated 2026-09-28 with: prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- from D:\My_Code\miladwani-source\prisma\schema.prisma (supersedes the Aug 22 create_tables.sql + add_family_join_requests.sql).
-- Run ONCE on an EMPTY database (phpMyAdmin -> Import). Next: 02_ladwani_reference_data.sql.

SET NAMES utf8mb4;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `mobile` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `mobileVerified` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'BLOCKED', 'DEACTIVATED') NOT NULL DEFAULT 'PENDING',
    `lastLoginAt` DATETIME(3) NULL,
    `lastLoginIp` VARCHAR(191) NULL,
    `failedAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_mobile_key`(`mobile`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `permissions_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `familyId` VARCHAR(191) NULL,
    `areaId` VARCHAR(191) NULL,
    `grantedBy` VARCHAR(191) NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verification_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `deviceInfo` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consent_records` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `consentType` VARCHAR(191) NOT NULL,
    `granted` BOOLEAN NOT NULL,
    `version` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `families` (
    `id` VARCHAR(191) NOT NULL,
    `registrationNumber` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `surname` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `kuladevata` VARCHAR(191) NULL,
    `kuladevi` VARCHAR(191) NULL,
    `gotra` VARCHAR(191) NULL,
    `traditionalOccupation` VARCHAR(191) NULL,
    `nativeVillage` VARCHAR(191) NULL,
    `nativeDistrict` VARCHAR(191) NULL,
    `nativeState` VARCHAR(191) NULL,
    `nativeCountry` VARCHAR(191) NOT NULL DEFAULT 'India',
    `kartaMemberId` VARCHAR(191) NULL,
    `familyPhotoId` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'INACTIVE', 'MERGED', 'ARCHIVED') NOT NULL DEFAULT 'PENDING',
    `verificationStatus` ENUM('UNVERIFIED', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'UNVERIFIED',
    `verifiedBy` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `communityId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `families_registrationNumber_key`(`registrationNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `family_members` (
    `id` VARCHAR(191) NOT NULL,
    `familyId` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `isKarta` BOOLEAN NOT NULL DEFAULT false,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `joinedBy` VARCHAR(191) NULL,
    `leftAt` DATETIME(3) NULL,
    `leftReason` VARCHAR(191) NULL,

    UNIQUE INDEX `family_members_familyId_memberId_key`(`familyId`, `memberId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `family_join_requests` (
    `id` VARCHAR(191) NOT NULL,
    `familyId` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `relatedToMemberId` VARCHAR(191) NULL,
    `relationshipTypeCode` VARCHAR(191) NOT NULL,
    `requestedBy` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `family_join_requests_familyId_memberId_status_key`(`familyId`, `memberId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `members` (
    `id` VARCHAR(191) NOT NULL,
    `memberNumber` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `middleName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `gender` ENUM('MALE', 'FEMALE', 'OTHER', 'NOT_STATED') NOT NULL DEFAULT 'NOT_STATED',
    `dateOfBirth` DATETIME(3) NULL,
    `dateOfBirthApprox` BOOLEAN NOT NULL DEFAULT false,
    `bloodGroup` VARCHAR(191) NULL,
    `mobilePrimary` VARCHAR(191) NULL,
    `mobileAlternate` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `profilePhotoId` VARCHAR(191) NULL,
    `biography` TEXT NULL,
    `currentCity` VARCHAR(191) NULL,
    `currentState` VARCHAR(191) NULL,
    `currentCountry` VARCHAR(191) NULL,
    `nativeVillage` VARCHAR(191) NULL,
    `nativeDistrict` VARCHAR(191) NULL,
    `nativeState` VARCHAR(191) NULL,
    `nationality` VARCHAR(191) NOT NULL DEFAULT 'Indian',
    `maritalStatus` ENUM('UNMARRIED', 'MARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED', 'NOT_STATED') NOT NULL DEFAULT 'UNMARRIED',
    `employmentStatus` VARCHAR(191) NULL,
    `occupationCategory` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'DECEASED', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `deceasedAt` DATETIME(3) NULL,
    `deceasedPlace` VARCHAR(191) NULL,
    `deceasedNotes` TEXT NULL,
    `verificationStatus` ENUM('UNVERIFIED', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'UNVERIFIED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `members_memberNumber_key`(`memberNumber`),
    UNIQUE INDEX `members_userId_key`(`userId`),
    UNIQUE INDEX `members_profilePhotoId_key`(`profilePhotoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relationship_types` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `inverseCode` VARCHAR(191) NULL,
    `genderApplicable` VARCHAR(191) NULL,
    `isSpouse` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `relationship_types_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_relationships` (
    `id` VARCHAR(191) NOT NULL,
    `fromMemberId` VARCHAR(191) NOT NULL,
    `toMemberId` VARCHAR(191) NOT NULL,
    `relationshipTypeId` VARCHAR(191) NOT NULL,
    `familyId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `member_relationships_fromMemberId_toMemberId_relationshipTyp_key`(`fromMemberId`, `toMemberId`, `relationshipTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `marital_status_history` (
    `id` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `status` ENUM('UNMARRIED', 'MARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED', 'NOT_STATED') NOT NULL,
    `effectiveDate` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `changedBy` VARCHAR(191) NULL,
    `approvalId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `marriage_records` (
    `id` VARCHAR(191) NOT NULL,
    `memberId1` VARCHAR(191) NOT NULL,
    `memberId2` VARCHAR(191) NULL,
    `externalSpouseName` VARCHAR(191) NULL,
    `externalSpouseInfo` JSON NULL,
    `marriageDate` DATETIME(3) NULL,
    `marriagePlace` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'MARRIED',
    `dissolutionDate` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `education_records` (
    `id` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `level` VARCHAR(191) NULL,
    `qualification` VARCHAR(191) NULL,
    `specialization` VARCHAR(191) NULL,
    `institution` VARCHAR(191) NULL,
    `yearCompleted` INTEGER NULL,
    `isHighest` BOOLEAN NOT NULL DEFAULT false,
    `isOngoing` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employment_records` (
    `id` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `employmentType` VARCHAR(191) NULL,
    `employerName` VARCHAR(191) NULL,
    `designation` VARCHAR(191) NULL,
    `industry` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `incomeRangeId` VARCHAR(191) NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `isCurrent` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `businesses` (
    `id` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `businessName` VARCHAR(191) NULL,
    `businessType` VARCHAR(191) NULL,
    `industry` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `website` VARCHAR(191) NULL,
    `establishedYear` INTEGER NULL,
    `incomeRangeId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skills` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `skills_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_skills` (
    `memberId` VARCHAR(191) NOT NULL,
    `skillId` VARCHAR(191) NOT NULL,
    `level` VARCHAR(191) NULL,

    PRIMARY KEY (`memberId`, `skillId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `income_ranges` (
    `id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `minValue` BIGINT NULL,
    `maxValue` BIGINT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `addresses` (
    `id` VARCHAR(191) NOT NULL,
    `addressableType` VARCHAR(191) NOT NULL,
    `familyId` VARCHAR(191) NULL,
    `memberId` VARCHAR(191) NULL,
    `addressType` VARCHAR(191) NOT NULL,
    `line1` VARCHAR(191) NULL,
    `line2` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `district` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `country` VARCHAR(191) NOT NULL DEFAULT 'India',
    `pincode` VARCHAR(191) NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `matrimonial_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `isVisible` BOOLEAN NOT NULL DEFAULT false,
    `about` TEXT NULL,
    `heightCm` INTEGER NULL,
    `languages` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NULL,

    UNIQUE INDEX `matrimonial_profiles_memberId_key`(`memberId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `matrimonial_preferences` (
    `id` VARCHAR(191) NOT NULL,
    `matrimonialProfileId` VARCHAR(191) NOT NULL,
    `minAge` INTEGER NULL,
    `maxAge` INTEGER NULL,
    `preferredGender` ENUM('MALE', 'FEMALE', 'OTHER', 'NOT_STATED') NULL,
    `preferredLocations` JSON NULL,
    `educationPreference` VARCHAR(191) NULL,
    `occupationPreference` VARCHAR(191) NULL,
    `incomeRangeId` VARCHAR(191) NULL,
    `maritalStatusPref` JSON NULL,
    `otherPreferences` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `matrimonial_preferences_matrimonialProfileId_key`(`matrimonialProfileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `matrimonial_interests` (
    `id` VARCHAR(191) NOT NULL,
    `fromMemberId` VARCHAR(191) NOT NULL,
    `toMemberId` VARCHAR(191) NOT NULL,
    `message` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `statusChangedAt` DATETIME(3) NULL,
    `statusNote` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `matrimonial_saves` (
    `memberId` VARCHAR(191) NOT NULL,
    `savedMemberId` VARCHAR(191) NOT NULL,
    `savedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`memberId`, `savedMemberId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `areas` (
    `id` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_areas` (
    `memberId` VARCHAR(191) NOT NULL,
    `areaId` VARCHAR(191) NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`memberId`, `areaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `family_areas` (
    `familyId` VARCHAR(191) NOT NULL,
    `areaId` VARCHAR(191) NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`familyId`, `areaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post_types` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `icon` VARCHAR(191) NULL,
    `requiresApproval` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `post_types_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `posts` (
    `id` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `postTypeId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `content` TEXT NULL,
    `visibility` VARCHAR(191) NOT NULL DEFAULT 'COMMUNITY',
    `targetAreaId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'HIDDEN', 'REMOVED', 'FLAGGED') NOT NULL DEFAULT 'PUBLISHED',
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `isAnnouncement` BOOLEAN NOT NULL DEFAULT false,
    `eventDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comments` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reactions` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NULL,
    `commentId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reactionType` VARCHAR(191) NOT NULL DEFAULT 'LIKE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `reactions_postId_userId_key`(`postId`, `userId`),
    UNIQUE INDEX `reactions_commentId_userId_key`(`commentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` VARCHAR(191) NOT NULL,
    `reportableType` VARCHAR(191) NOT NULL,
    `reportableId` VARCHAR(191) NOT NULL,
    `reporterId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `resolvedBy` VARCHAR(191) NULL,
    `resolutionNote` VARCHAR(191) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photos` (
    `id` VARCHAR(191) NOT NULL,
    `ownerType` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NULL,
    `familyId` VARCHAR(191) NULL,
    `postId` VARCHAR(191) NULL,
    `uploadedBy` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `thumbnailKey` VARCHAR(191) NULL,
    `optimizedKey` VARCHAR(191) NULL,
    `originalFilename` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NULL,
    `fileSizeBytes` BIGINT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `isProfilePhoto` BOOLEAN NOT NULL DEFAULT false,
    `caption` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_rules` (
    `id` VARCHAR(191) NOT NULL,
    `actionCode` VARCHAR(191) NOT NULL,
    `requiresApproval` BOOLEAN NOT NULL DEFAULT true,
    `approverRole` VARCHAR(191) NULL,
    `autoApproveRole` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `approval_rules_actionCode_key`(`actionCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approvals` (
    `id` VARCHAR(191) NOT NULL,
    `actionCode` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `fieldName` VARCHAR(191) NULL,
    `oldValue` JSON NULL,
    `newValue` JSON NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RETURNED', 'ESCALATED') NOT NULL DEFAULT 'SUBMITTED',
    `submittedBy` VARCHAR(191) NOT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `reason` TEXT NULL,
    `escalatedTo` VARCHAR(191) NULL,
    `escalatedAt` DATETIME(3) NULL,
    `escalationNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `actorRole` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `fieldName` VARCHAR(191) NULL,
    `oldValue` JSON NULL,
    `newValue` JSON NULL,
    `approvalId` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NULL,
    `data` JSON NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `emailSent` BOOLEAN NOT NULL DEFAULT false,
    `smsSent` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `description` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `settings_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `field_visibility_defaults` (
    `entityType` VARCHAR(191) NOT NULL,
    `fieldName` VARCHAR(191) NOT NULL,
    `defaultVisibility` VARCHAR(191) NOT NULL,
    `isUserConfigurable` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`entityType`, `fieldName`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_field_visibility` (
    `memberId` VARCHAR(191) NOT NULL,
    `fieldName` VARCHAR(191) NOT NULL,
    `visibility` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`memberId`, `fieldName`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `blocked_users` (
    `blockerId` VARCHAR(191) NOT NULL,
    `blockedId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `blockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`blockerId`, `blockedId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_familyId_fkey` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `verification_tokens` ADD CONSTRAINT `verification_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consent_records` ADD CONSTRAINT `consent_records_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `families` ADD CONSTRAINT `families_kartaMemberId_fkey` FOREIGN KEY (`kartaMemberId`) REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_members` ADD CONSTRAINT `family_members_familyId_fkey` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_members` ADD CONSTRAINT `family_members_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_join_requests` ADD CONSTRAINT `family_join_requests_familyId_fkey` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_join_requests` ADD CONSTRAINT `family_join_requests_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `members` ADD CONSTRAINT `members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `members` ADD CONSTRAINT `members_profilePhotoId_fkey` FOREIGN KEY (`profilePhotoId`) REFERENCES `photos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_relationships` ADD CONSTRAINT `member_relationships_fromMemberId_fkey` FOREIGN KEY (`fromMemberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_relationships` ADD CONSTRAINT `member_relationships_toMemberId_fkey` FOREIGN KEY (`toMemberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_relationships` ADD CONSTRAINT `member_relationships_relationshipTypeId_fkey` FOREIGN KEY (`relationshipTypeId`) REFERENCES `relationship_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `marital_status_history` ADD CONSTRAINT `marital_status_history_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `marital_status_history` ADD CONSTRAINT `marital_status_history_approvalId_fkey` FOREIGN KEY (`approvalId`) REFERENCES `approvals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `marriage_records` ADD CONSTRAINT `marriage_records_memberId1_fkey` FOREIGN KEY (`memberId1`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `marriage_records` ADD CONSTRAINT `marriage_records_memberId2_fkey` FOREIGN KEY (`memberId2`) REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `education_records` ADD CONSTRAINT `education_records_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employment_records` ADD CONSTRAINT `employment_records_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employment_records` ADD CONSTRAINT `employment_records_incomeRangeId_fkey` FOREIGN KEY (`incomeRangeId`) REFERENCES `income_ranges`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `businesses` ADD CONSTRAINT `businesses_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `businesses` ADD CONSTRAINT `businesses_incomeRangeId_fkey` FOREIGN KEY (`incomeRangeId`) REFERENCES `income_ranges`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_skills` ADD CONSTRAINT `member_skills_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_skills` ADD CONSTRAINT `member_skills_skillId_fkey` FOREIGN KEY (`skillId`) REFERENCES `skills`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `addresses` ADD CONSTRAINT `addresses_familyId_fkey` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `addresses` ADD CONSTRAINT `addresses_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matrimonial_profiles` ADD CONSTRAINT `matrimonial_profiles_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matrimonial_preferences` ADD CONSTRAINT `matrimonial_preferences_matrimonialProfileId_fkey` FOREIGN KEY (`matrimonialProfileId`) REFERENCES `matrimonial_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matrimonial_preferences` ADD CONSTRAINT `matrimonial_preferences_incomeRangeId_fkey` FOREIGN KEY (`incomeRangeId`) REFERENCES `income_ranges`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matrimonial_interests` ADD CONSTRAINT `matrimonial_interests_fromMemberId_fkey` FOREIGN KEY (`fromMemberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matrimonial_interests` ADD CONSTRAINT `matrimonial_interests_toMemberId_fkey` FOREIGN KEY (`toMemberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matrimonial_saves` ADD CONSTRAINT `matrimonial_saves_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matrimonial_saves` ADD CONSTRAINT `matrimonial_saves_savedMemberId_fkey` FOREIGN KEY (`savedMemberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `areas` ADD CONSTRAINT `areas_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_areas` ADD CONSTRAINT `member_areas_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_areas` ADD CONSTRAINT `member_areas_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_areas` ADD CONSTRAINT `family_areas_familyId_fkey` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_areas` ADD CONSTRAINT `family_areas_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `posts_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `posts_postTypeId_fkey` FOREIGN KEY (`postTypeId`) REFERENCES `post_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `posts_targetAreaId_fkey` FOREIGN KEY (`targetAreaId`) REFERENCES `areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `comments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reactions` ADD CONSTRAINT `reactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reactions` ADD CONSTRAINT `reactions_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reactions` ADD CONSTRAINT `reactions_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photos` ADD CONSTRAINT `photos_uploadedBy_fkey` FOREIGN KEY (`uploadedBy`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photos` ADD CONSTRAINT `photos_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photos` ADD CONSTRAINT `photos_familyId_fkey` FOREIGN KEY (`familyId`) REFERENCES `families`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photos` ADD CONSTRAINT `photos_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approvals` ADD CONSTRAINT `approvals_submittedBy_fkey` FOREIGN KEY (`submittedBy`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approvals` ADD CONSTRAINT `approvals_reviewedBy_fkey` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_field_visibility` ADD CONSTRAINT `member_field_visibility_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `blocked_users` ADD CONSTRAINT `blocked_users_blockerId_fkey` FOREIGN KEY (`blockerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `blocked_users` ADD CONSTRAINT `blocked_users_blockedId_fkey` FOREIGN KEY (`blockedId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

