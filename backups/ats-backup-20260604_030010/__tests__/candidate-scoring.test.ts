import { describe, it, expect } from 'vitest';

describe('ATS Candidate Scoring', () => {
  describe('Experience Score Calculation', () => {
    const calculateExperienceScore = (
      yearsExperience: number,
      requiredMinYears: number,
      requiredMaxYears: number
    ): number => {
      if (yearsExperience < requiredMinYears) {
        // Below minimum - score reduces proportionally
        return Math.max(0, (yearsExperience / requiredMinYears) * 50);
      }

      if (yearsExperience >= requiredMinYears && yearsExperience <= requiredMaxYears) {
        // Within range - full score
        return 100;
      }

      // Over-qualified - slight penalty
      const overYears = yearsExperience - requiredMaxYears;
      return Math.max(50, 100 - overYears * 5);
    };

    it('should give full score for experience in range', () => {
      expect(calculateExperienceScore(3, 2, 5)).toBe(100);
      expect(calculateExperienceScore(2, 2, 5)).toBe(100);
      expect(calculateExperienceScore(5, 2, 5)).toBe(100);
    });

    it('should penalize under-qualified candidates', () => {
      expect(calculateExperienceScore(1, 2, 5)).toBe(25); // 1/2 * 50
      expect(calculateExperienceScore(0, 2, 5)).toBe(0);
    });

    it('should slightly penalize over-qualified candidates', () => {
      expect(calculateExperienceScore(6, 2, 5)).toBe(95); // 100 - 1*5
      expect(calculateExperienceScore(8, 2, 5)).toBe(85); // 100 - 3*5
      expect(calculateExperienceScore(15, 2, 5)).toBe(50); // Floor at 50
    });

    it('should handle exact minimum', () => {
      expect(calculateExperienceScore(2, 2, 5)).toBe(100);
    });

    it('should handle exact maximum', () => {
      expect(calculateExperienceScore(5, 2, 5)).toBe(100);
    });
  });

  describe('Skill Match Score', () => {
    const calculateSkillMatchScore = (
      candidateSkills: string[],
      requiredSkills: string[],
      preferredSkills: string[]
    ): { score: number; requiredMatch: number; preferredMatch: number } => {
      const candidateSkillsLower = candidateSkills.map((s) => s.toLowerCase());
      const requiredSkillsLower = requiredSkills.map((s) => s.toLowerCase());
      const preferredSkillsLower = preferredSkills.map((s) => s.toLowerCase());

      const requiredMatches = requiredSkillsLower.filter((skill) =>
        candidateSkillsLower.includes(skill)
      ).length;
      const preferredMatches = preferredSkillsLower.filter((skill) =>
        candidateSkillsLower.includes(skill)
      ).length;

      const requiredMatch =
        requiredSkills.length > 0 ? (requiredMatches / requiredSkills.length) * 100 : 100;
      const preferredMatch =
        preferredSkills.length > 0 ? (preferredMatches / preferredSkills.length) * 100 : 0;

      // Weighted: 70% required, 30% preferred
      const score = requiredMatch * 0.7 + preferredMatch * 0.3;

      return {
        score: Math.round(score * 100) / 100,
        requiredMatch: Math.round(requiredMatch * 100) / 100,
        preferredMatch: Math.round(preferredMatch * 100) / 100,
      };
    };

    it('should give full score for all skills matched', () => {
      const result = calculateSkillMatchScore(
        ['JavaScript', 'React', 'Node.js', 'TypeScript'],
        ['JavaScript', 'React'],
        ['Node.js', 'TypeScript']
      );

      expect(result.requiredMatch).toBe(100);
      expect(result.preferredMatch).toBe(100);
      expect(result.score).toBe(100);
    });

    it('should score required skills higher than preferred', () => {
      const result = calculateSkillMatchScore(
        ['JavaScript', 'React'],
        ['JavaScript', 'React'],
        ['Node.js', 'TypeScript']
      );

      expect(result.requiredMatch).toBe(100);
      expect(result.preferredMatch).toBe(0);
      expect(result.score).toBe(70); // 100*0.7 + 0*0.3
    });

    it('should handle partial matches', () => {
      const result = calculateSkillMatchScore(
        ['JavaScript', 'Node.js'],
        ['JavaScript', 'React', 'TypeScript'],
        ['Node.js']
      );

      expect(result.requiredMatch).toBeCloseTo(33.33, 1); // 1/3
      expect(result.preferredMatch).toBe(100);
      expect(result.score).toBeCloseTo(53.33, 1); // 33.33*0.7 + 100*0.3
    });

    it('should be case-insensitive', () => {
      const result = calculateSkillMatchScore(
        ['javascript', 'REACT'],
        ['JavaScript', 'React'],
        []
      );

      expect(result.requiredMatch).toBe(100);
    });

    it('should handle no required skills', () => {
      const result = calculateSkillMatchScore(['JavaScript'], [], ['TypeScript']);

      expect(result.requiredMatch).toBe(100); // No required = auto 100
      expect(result.score).toBe(70); // 100*0.7 + 0*0.3 (preferred not matched)
    });
  });

  describe('Education Score', () => {
    const calculateEducationScore = (
      candidateQualification: string,
      requiredQualification: string
    ): number => {
      const qualificationRank: Record<string, number> = {
        '10th': 1,
        '12th': 2,
        diploma: 3,
        graduation: 4,
        'post-graduation': 5,
        phd: 6,
      };

      const candidateRank = qualificationRank[candidateQualification.toLowerCase()] || 0;
      const requiredRank = qualificationRank[requiredQualification.toLowerCase()] || 0;

      if (candidateRank >= requiredRank) {
        return 100; // Meets or exceeds requirement
      }

      // Below requirement - proportional score
      return requiredRank > 0 ? (candidateRank / requiredRank) * 70 : 0;
    };

    it('should give full score for meeting requirement', () => {
      expect(calculateEducationScore('Graduation', 'Graduation')).toBe(100);
    });

    it('should give full score for exceeding requirement', () => {
      expect(calculateEducationScore('Post-Graduation', 'Graduation')).toBe(100);
      expect(calculateEducationScore('PhD', 'Graduation')).toBe(100);
    });

    it('should penalize below requirement', () => {
      expect(calculateEducationScore('12th', 'Graduation')).toBe(35); // 2/4 * 70
      expect(calculateEducationScore('10th', 'Graduation')).toBe(17.5); // 1/4 * 70
    });

    it('should handle exact match', () => {
      expect(calculateEducationScore('Diploma', 'Diploma')).toBe(100);
    });

    it('should be case-insensitive', () => {
      expect(calculateEducationScore('GRADUATION', 'graduation')).toBe(100);
    });
  });

  describe('Overall Candidate Score', () => {
    const calculateOverallScore = (scores: {
      experienceScore: number;
      skillScore: number;
      educationScore: number;
      interviewScore?: number;
    }): { totalScore: number; grade: string } => {
      const weights = {
        experience: 0.3,
        skills: 0.4,
        education: 0.2,
        interview: 0.1,
      };

      const totalScore =
        scores.experienceScore * weights.experience +
        scores.skillScore * weights.skills +
        scores.educationScore * weights.education +
        (scores.interviewScore || 0) * weights.interview;

      let grade = 'F';
      if (totalScore >= 90) grade = 'A';
      else if (totalScore >= 80) grade = 'B';
      else if (totalScore >= 70) grade = 'C';
      else if (totalScore >= 60) grade = 'D';

      return {
        totalScore: Math.round(totalScore * 100) / 100,
        grade,
      };
    };

    it('should calculate perfect score as A grade', () => {
      const result = calculateOverallScore({
        experienceScore: 100,
        skillScore: 100,
        educationScore: 100,
        interviewScore: 100,
      });

      expect(result.totalScore).toBe(100);
      expect(result.grade).toBe('A');
    });

    it('should weight skills highest (40%)', () => {
      const result = calculateOverallScore({
        experienceScore: 0,
        skillScore: 100,
        educationScore: 0,
        interviewScore: 0,
      });

      expect(result.totalScore).toBe(40);
    });

    it('should calculate B grade correctly', () => {
      const result = calculateOverallScore({
        experienceScore: 80,
        skillScore: 85,
        educationScore: 80,
        interviewScore: 90,
      });

      // 80*0.3 + 85*0.4 + 80*0.2 + 90*0.1 = 24 + 34 + 16 + 9 = 83
      expect(result.totalScore).toBe(83);
      expect(result.grade).toBe('B');
    });

    it('should handle missing interview score', () => {
      const result = calculateOverallScore({
        experienceScore: 90,
        skillScore: 80,
        educationScore: 85,
      });

      // 90*0.3 + 80*0.4 + 85*0.2 + 0*0.1 = 27 + 32 + 17 + 0 = 76
      expect(result.totalScore).toBe(76);
      expect(result.grade).toBe('C');
    });

    it('should assign F grade for low scores', () => {
      const result = calculateOverallScore({
        experienceScore: 50,
        skillScore: 40,
        educationScore: 30,
        interviewScore: 50,
      });

      expect(result.grade).toBe('F');
    });
  });

  describe('Candidate Filtering', () => {
    const shouldShortlist = (
      overallScore: number,
      requiredSkillMatch: number,
      minScoreThreshold: number,
      minRequiredSkillThreshold: number
    ): { shortlisted: boolean; reason?: string } => {
      if (requiredSkillMatch < minRequiredSkillThreshold) {
        return {
          shortlisted: false,
          reason: `Required skills below threshold (${requiredSkillMatch}% < ${minRequiredSkillThreshold}%)`,
        };
      }

      if (overallScore < minScoreThreshold) {
        return {
          shortlisted: false,
          reason: `Overall score below threshold (${overallScore} < ${minScoreThreshold})`,
        };
      }

      return { shortlisted: true };
    };

    it('should shortlist qualified candidates', () => {
      const result = shouldShortlist(85, 100, 70, 80);

      expect(result.shortlisted).toBe(true);
    });

    it('should reject candidates with low required skill match', () => {
      const result = shouldShortlist(90, 70, 70, 80);

      expect(result.shortlisted).toBe(false);
      expect(result.reason).toContain('Required skills below threshold');
    });

    it('should reject candidates with low overall score', () => {
      const result = shouldShortlist(65, 100, 70, 80);

      expect(result.shortlisted).toBe(false);
      expect(result.reason).toContain('Overall score below threshold');
    });

    it('should shortlist candidates at exact threshold', () => {
      const result = shouldShortlist(70, 80, 70, 80);

      expect(result.shortlisted).toBe(true);
    });

    it('should prioritize required skills over overall score', () => {
      const resultA = shouldShortlist(95, 75, 70, 80); // High score, low required skills
      const resultB = shouldShortlist(72, 100, 70, 80); // Low score, high required skills

      expect(resultA.shortlisted).toBe(false);
      expect(resultB.shortlisted).toBe(true);
    });
  });
});
